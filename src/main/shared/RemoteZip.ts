import { Transform, type TransformCallback } from 'stream';
import type { HttpClient } from './HttpClient.ts';
import {
  LOCAL_HEADER_SIZE,
  ZIP_TAIL_SIZE,
  assertSupportedMethod,
  localHeaderLength,
  locateCentralDirectory,
  parseCentralDirectory,
  writeEntryStream,
  type ZipEntry,
} from './ZipReader.ts';

const ENTRY_ATTEMPTS = 3;

/**
 * A zip on an HTTP server that honours Range requests, read entry by entry
 * without downloading the archive: one request for its end records (and its
 * central directory when it fits there), at most one more for the directory,
 * then one request per entry actually extracted.
 *
 * Every request carries If-Range with the ETag seen first: if the file is
 * republished in the middle, the server answers 200 instead of 206 and the
 * read fails with RangeUnsupportedError instead of mixing two versions.
 */
export class RemoteZip {
  readonly entries: ZipEntry[];
  /** Bytes the archive takes on the server. */
  readonly size: number;
  readonly etag: string;
  private readonly http: HttpClient;
  private readonly url: string;
  private readonly spanEnd = new Map<ZipEntry, number>();

  private constructor(http: HttpClient, url: string, entries: ZipEntry[], size: number, etag: string, cdOffset: number) {
    this.http = http;
    this.url = url;
    this.entries = entries;
    this.size = size;
    this.etag = etag;
    // An entry's bytes run from its local header to the next local header (or the
    // central directory): one request covers header, data and any data descriptor.
    const byOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
    byOffset.forEach((entry, i) => {
      const next = i + 1 < byOffset.length ? byOffset[i + 1].localHeaderOffset : cdOffset;
      this.spanEnd.set(entry, next - 1);
    });
  }

  static async open(http: HttpClient, url: string): Promise<RemoteZip> {
    const tail = await http.getRange(url, { start: -ZIP_TAIL_SIZE });
    const etag = tail.etag;
    if (!etag) throw new Error(`Pas d'ETag pour ${url}: lecture partielle impossible`);
    const tailStart = tail.total - tail.body.length;
    const loc = await RemoteZip.locate(http, url, tail.body, tailStart, etag);

    let cd: Buffer;
    if (loc.cdOffset >= tailStart && loc.cdOffset + loc.cdSize <= tail.total) {
      cd = tail.body.subarray(loc.cdOffset - tailStart, loc.cdOffset - tailStart + loc.cdSize);
    } else {
      const part = await http.getRange(url, { start: loc.cdOffset, end: loc.cdOffset + loc.cdSize - 1, ifRange: etag });
      cd = part.body;
    }
    const entries = parseCentralDirectory(cd, loc.count, url);
    return new RemoteZip(http, url, entries, tail.total, etag, loc.cdOffset);
  }

  private static async locate(http: HttpClient, url: string, tail: Buffer, tailStart: number, etag: string) {
    let zip64: Buffer | null = null;
    let zip64Offset = -1;
    try {
      return locateCentralDirectory(tail, tailStart, url, (offset) => {
        zip64Offset = offset;
        if (zip64) return zip64;
        throw new NeedZip64Record();
      });
    } catch (e) {
      if (!(e instanceof NeedZip64Record)) throw e;
    }
    zip64 = (await http.getRange(url, { start: zip64Offset, end: zip64Offset + 55, ifRange: etag })).body;
    return locateCentralDirectory(tail, tailStart, url, () => zip64!);
  }

  /** Compressed bytes the server sends to extract these entries (headers included). */
  bytesFor(entries: ZipEntry[]): number {
    return entries.reduce((sum, e) => sum + this.spanEnd.get(e)! - e.localHeaderOffset + 1, 0);
  }

  /**
   * Downloads one entry and writes it to `target` (temp file, size + CRC
   * checked, renamed). Network errors are retried; a republished archive is not.
   */
  async extractTo(
    entry: ZipEntry,
    target: string,
    { durable = false, onBytes }: { durable?: boolean; onBytes?: (n: number) => void } = {},
  ): Promise<void> {
    assertSupportedMethod(entry);
    const end = this.spanEnd.get(entry);
    if (end === undefined) throw new Error(`Entrée inconnue: ${entry.entryName}`);
    let lastError: unknown;
    for (let attempt = 1; attempt <= ENTRY_ATTEMPTS; attempt++) {
      let counted = 0;
      try {
        const res = await this.http.openRange(this.url, { start: entry.localHeaderOffset, end, ifRange: this.etag });
        res.stream.on('data', (chunk: Buffer) => {
          counted += chunk.length;
          onBytes?.(chunk.length);
        });
        await writeEntryStream(res.stream.pipe(new LocalEntryData(entry)), entry, target, { durable });
        return;
      } catch (e) {
        lastError = e;
        if (counted) onBytes?.(-counted);
        if ((e as Error).name === 'RangeUnsupportedError') throw e;
      }
    }
    throw lastError;
  }
}

class NeedZip64Record extends Error {}

/**
 * Turns the bytes of a local entry span (local header, data, maybe a data
 * descriptor) into just the compressed data of the entry.
 */
class LocalEntryData extends Transform {
  private readonly entry: ZipEntry;
  private header: Buffer | null = Buffer.alloc(0);
  private skip = 0;
  private left: number;

  constructor(entry: ZipEntry) {
    super();
    this.entry = entry;
    this.left = entry.compressedSize;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    try {
      let data = chunk;
      if (this.header) {
        this.header = Buffer.concat([this.header, data]);
        if (this.header.length < LOCAL_HEADER_SIZE) return done();
        this.skip = localHeaderLength(this.header.subarray(0, LOCAL_HEADER_SIZE), this.entry);
        data = this.header;
        this.header = null;
      }
      if (this.skip > 0) {
        const n = Math.min(this.skip, data.length);
        this.skip -= n;
        data = data.subarray(n);
      }
      if (this.left > 0 && data.length > 0) {
        const n = Math.min(this.left, data.length);
        this.left -= n;
        this.push(data.subarray(0, n));
      }
      done();
    } catch (e) {
      done(e as Error);
    }
  }

  _flush(done: TransformCallback): void {
    if (this.header || this.skip > 0 || this.left > 0) {
      done(new Error(`Entrée zip tronquée: ${this.entry.entryName}`));
      return;
    }
    done();
  }
}
