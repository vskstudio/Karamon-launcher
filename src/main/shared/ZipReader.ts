import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { fsyncFile } from './AtomicWrite.ts';

let tmpCounter = 0;

/**
 * Reads a zip from disk one entry at a time. Only the central directory and the
 * entry being read sit in memory, so a 400 Mo mods.zip costs the size of its
 * biggest jar instead of the whole archive (adm-zip loads the full file).
 *
 * Sizes and offsets come from the central directory, so entries whose general
 * purpose flag announces a data descriptor that is not there still read fine.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

export interface ZipEntry {
  entryName: string;
  isDirectory: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export class ZipReader {
  readonly entries: ZipEntry[];
  private fd: number | null;

  private constructor(fd: number, entries: ZipEntry[]) {
    this.fd = fd;
    this.entries = entries;
  }

  static open(zipPath: string): ZipReader {
    const fd = fs.openSync(zipPath, 'r');
    try {
      return new ZipReader(fd, readCentralDirectory(fd, fs.fstatSync(fd).size, zipPath));
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
  }

  /** Opens, runs `fn`, and always closes the file. */
  static with<T>(zipPath: string, fn: (zip: ZipReader) => T): T {
    const zip = ZipReader.open(zipPath);
    try {
      return fn(zip);
    } finally {
      zip.close();
    }
  }

  /** Async variant of `with`: the file stays open until `fn` settles. */
  static async withAsync<T>(zipPath: string, fn: (zip: ZipReader) => Promise<T>): Promise<T> {
    const zip = ZipReader.open(zipPath);
    try {
      return await fn(zip);
    } finally {
      zip.close();
    }
  }

  /** Whole entry in memory: for small files (configs) only. */
  read(entry: ZipEntry): Buffer {
    const fd = this.requireFd();
    const header = readAt(fd, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
    if (header.length < LOCAL_HEADER_SIZE || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`Entrée zip illisible: ${entry.entryName}`);
    }
    const start = entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
    const compressed = readAt(fd, start, entry.compressedSize);
    if (compressed.length !== entry.compressedSize) {
      throw new Error(`Entrée zip tronquée: ${entry.entryName}`);
    }
    let data: Buffer;
    if (entry.method === STORED) data = compressed;
    else if (entry.method === DEFLATED) {
      try {
        data = zlib.inflateRawSync(compressed);
      } catch {
        throw new Error(`Entrée zip corrompue: ${entry.entryName}`);
      }
    } else throw new Error(`Compression zip non supportée (${entry.method}): ${entry.entryName}`);
    if (data.length !== entry.size) {
      throw new Error(`Entrée zip corrompue: ${entry.entryName}`);
    }
    if (zlib.crc32(data) !== entry.crc) {
      throw new Error(`Checksum zip invalide: ${entry.entryName}`);
    }
    return data;
  }

  /**
   * Streams one entry to `target` without holding it in memory, and without
   * blocking the event loop (the Electron main process keeps answering the
   * window). The data goes to a temp file next to the target, its size and CRC
   * are checked, then it is renamed over the target; with `durable` the temp
   * file is flushed to disk first, so a power cut never leaves a zero-filled file.
   */
  async extractTo(entry: ZipEntry, target: string, { durable = false }: { durable?: boolean } = {}): Promise<void> {
    const fd = this.requireFd();
    const header = readAt(fd, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
    if (header.length < LOCAL_HEADER_SIZE || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`Entrée zip illisible: ${entry.entryName}`);
    }
    if (entry.method !== STORED && entry.method !== DEFLATED) {
      throw new Error(`Compression zip non supportée (${entry.method}): ${entry.entryName}`);
    }
    const start = entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${++tmpCounter}.karamon-tmp`);
    let crc = 0;
    let size = 0;
    const check = new Transform({
      transform(chunk: Buffer, _enc, done) {
        crc = zlib.crc32(chunk, crc);
        size += chunk.length;
        done(null, chunk);
      },
    });
    try {
      const source =
        entry.compressedSize === 0
          ? Readable.from([])
          : fs.createReadStream('', { fd, autoClose: false, start, end: start + entry.compressedSize - 1 });
      const out = fs.createWriteStream(tmp);
      const piped =
        entry.method === DEFLATED ? pipeline(source, zlib.createInflateRaw(), check, out) : pipeline(source, check, out);
      await piped.catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Entrée zip corrompue: ${entry.entryName} (${message})`);
      });
      if (size !== entry.size) throw new Error(`Entrée zip corrompue: ${entry.entryName}`);
      if (crc !== entry.crc) throw new Error(`Checksum zip invalide: ${entry.entryName}`);
      if (durable) fsyncFile(tmp);
      await fs.promises.rename(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }

  close(): void {
    if (this.fd === null) return;
    fs.closeSync(this.fd);
    this.fd = null;
  }

  private requireFd(): number {
    if (this.fd === null) throw new Error('ZipReader fermé');
    return this.fd;
  }
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buffer, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buffer : buffer.subarray(0, done);
}

function readCentralDirectory(fd: number, fileSize: number, label: string): ZipEntry[] {
  const tailLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
  const tailStart = fileSize - tailLength;
  const tail = readAt(fd, tailStart, tailLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Archive zip invalide (fin d'archive introuvable): ${label}`);

  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);

  if (count === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX) {
    const locator = eocd - 20;
    if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
      const z64 = readAt(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (z64.length === 56 && z64.readUInt32LE(0) === ZIP64_EOCD_SIGNATURE) {
        count = Number(z64.readBigUInt64LE(32));
        cdSize = Number(z64.readBigUInt64LE(40));
        cdOffset = Number(z64.readBigUInt64LE(48));
      }
    }
  }

  const cd = readAt(fd, cdOffset, cdSize);
  if (cd.length !== cdSize) throw new Error(`Archive zip tronquée: ${label}`);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new Error(`Répertoire zip corrompu: ${label}`);
    }
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let compressedSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    let localHeaderOffset = cd.readUInt32LE(p + 42);
    const entryName = cd.toString('utf8', p + 46, p + 46 + nameLength);

    if (size === U32_MAX || compressedSize === U32_MAX || localHeaderOffset === U32_MAX) {
      const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
      ({ size, compressedSize, localHeaderOffset } = zip64Extra(extra, size, compressedSize, localHeaderOffset));
    }

    entries.push({
      entryName,
      isDirectory: entryName.endsWith('/'),
      method,
      crc,
      compressedSize,
      size,
      localHeaderOffset,
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zip64Extra(
  extra: Buffer,
  size: number,
  compressedSize: number,
  localHeaderOffset: number,
): { size: number; compressedSize: number; localHeaderOffset: number } {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const length = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      const next = (): number => {
        const v = Number(extra.readBigUInt64LE(q));
        q += 8;
        return v;
      };
      if (size === U32_MAX) size = next();
      if (compressedSize === U32_MAX) compressedSize = next();
      if (localHeaderOffset === U32_MAX) localHeaderOffset = next();
      break;
    }
    p += 4 + length;
  }
  return { size, compressedSize, localHeaderOffset };
}
