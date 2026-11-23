import fs from 'fs';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const UTF8_NAMES_FLAG = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const VERSION_DEFAULT = 20;
const VERSION_ZIP64 = 45;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const DIRECTORY_ATTRIBUTE = 0x10;
const SIZE_NEEDING_ZIP64_LOCAL_HEADER = 0xf0000000;

interface WrittenEntry {
  name: Buffer;
  method: number;
  dosTime: number;
  dosDate: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  directory: boolean;
}

export class ZipWriter {
  private readonly handle: fs.promises.FileHandle;
  private readonly entries: WrittenEntry[] = [];
  private position = 0;

  private constructor(handle: fs.promises.FileHandle) {
    this.handle = handle;
  }

  static async create(target: string): Promise<ZipWriter> {
    return new ZipWriter(await fs.promises.open(target, 'w'));
  }

  async addDirectory(entryName: string, modified: Date): Promise<void> {
    const entry = this.newEntry(`${entryName.replace(/\/+$/, '')}/`, METHOD_STORED, modified, true);
    await this.append(this.localHeader(entry, false));
    this.entries.push(entry);
  }

  async addFile(source: string, entryName: string): Promise<void> {
    const stat = await fs.promises.stat(source);
    const entry = this.newEntry(entryName, METHOD_DEFLATED, stat.mtime, false);
    const zip64 = stat.size >= SIZE_NEEDING_ZIP64_LOCAL_HEADER;
    const header = this.localHeader(entry, zip64);
    await this.append(header);
    const dataStart = this.position;

    let crc = 0;
    let size = 0;
    await pipeline(
      fs.createReadStream(source),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          crc = zlib.crc32(chunk, crc);
          size += chunk.length;
          yield chunk;
        }
      },
      zlib.createDeflateRaw(),
      async (compressed: AsyncIterable<Buffer>) => {
        for await (const chunk of compressed) await this.append(chunk);
      },
    );

    entry.crc = crc;
    entry.size = size;
    entry.compressedSize = this.position - dataStart;
    if (!zip64 && (entry.size >= MAX_32 || entry.compressedSize >= MAX_32)) {
      throw new Error(`${source} a grossi pendant la sauvegarde`);
    }
    await this.patchSizes(entry, zip64);
    this.entries.push(entry);
  }

  async finish(): Promise<void> {
    const directoryOffset = this.position;
    for (const entry of this.entries) await this.append(this.centralHeader(entry));
    const directorySize = this.position - directoryOffset;
    const needsZip64 = this.entries.length >= MAX_16 || directoryOffset >= MAX_32 || directorySize >= MAX_32;
    if (needsZip64) {
      const zip64EndOffset = this.position;
      await this.append(this.zip64End(directoryOffset, directorySize));
      await this.append(this.zip64Locator(zip64EndOffset));
    }
    await this.append(this.end(directoryOffset, directorySize, needsZip64));
    await this.handle.sync();
    await this.handle.close();
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }

  private newEntry(entryName: string, method: number, modified: Date, directory: boolean): WrittenEntry {
    const { dosTime, dosDate } = dosDateTime(modified);
    return {
      name: Buffer.from(entryName, 'utf8'),
      method,
      dosTime,
      dosDate,
      crc: 0,
      compressedSize: 0,
      size: 0,
      offset: this.position,
      directory,
    };
  }

  private localHeader(entry: WrittenEntry, zip64: boolean): Buffer {
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(ZIP64_EXTRA_FIELD, 0);
      extra.writeUInt16LE(16, 2);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(zip64 ? VERSION_ZIP64 : VERSION_DEFAULT, 4);
    header.writeUInt16LE(UTF8_NAMES_FLAG, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.dosTime, 10);
    header.writeUInt16LE(entry.dosDate, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(zip64 ? MAX_32 : 0, 18);
    header.writeUInt32LE(zip64 ? MAX_32 : 0, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(extra.length, 28);
    return Buffer.concat([header, entry.name, extra]);
  }

  private async patchSizes(entry: WrittenEntry, zip64: boolean): Promise<void> {
    const crc = Buffer.alloc(4);
    crc.writeUInt32LE(entry.crc >>> 0, 0);
    await this.handle.write(crc, 0, 4, entry.offset + 14);
    if (zip64) {
      const sizes = Buffer.alloc(16);
      sizes.writeBigUInt64LE(BigInt(entry.size), 0);
      sizes.writeBigUInt64LE(BigInt(entry.compressedSize), 8);
      await this.handle.write(sizes, 0, 16, entry.offset + 30 + entry.name.length + 4);
      return;
    }
    const sizes = Buffer.alloc(8);
    sizes.writeUInt32LE(entry.compressedSize, 0);
    sizes.writeUInt32LE(entry.size, 4);
    await this.handle.write(sizes, 0, 8, entry.offset + 18);
  }

  private centralHeader(entry: WrittenEntry): Buffer {
    const wide: Buffer[] = [];
    const field = (value: number): number => {
      if (value < MAX_32) return value;
      const wideValue = Buffer.alloc(8);
      wideValue.writeBigUInt64LE(BigInt(value), 0);
      wide.push(wideValue);
      return MAX_32;
    };
    const size = field(entry.size);
    const compressedSize = field(entry.compressedSize);
    const offset = field(entry.offset);
    const extra = wide.length === 0 ? Buffer.alloc(0) : Buffer.concat([zip64ExtraHeader(wide.length * 8), ...wide]);
    const version = wide.length > 0 ? VERSION_ZIP64 : VERSION_DEFAULT;

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(VERSION_ZIP64, 4);
    header.writeUInt16LE(version, 6);
    header.writeUInt16LE(UTF8_NAMES_FLAG, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc >>> 0, 16);
    header.writeUInt32LE(compressedSize, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(entry.directory ? DIRECTORY_ATTRIBUTE : 0, 38);
    header.writeUInt32LE(offset, 42);
    return Buffer.concat([header, entry.name, extra]);
  }

  private zip64End(directoryOffset: number, directorySize: number): Buffer {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(VERSION_ZIP64, 12);
    record.writeUInt16LE(VERSION_ZIP64, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(this.entries.length), 24);
    record.writeBigUInt64LE(BigInt(this.entries.length), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    return record;
  }

  private zip64Locator(zip64EndOffset: number): Buffer {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_END_LOCATOR, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
    locator.writeUInt32LE(1, 16);
    return locator;
  }

  private end(directoryOffset: number, directorySize: number, zip64: boolean): Buffer {
    const count = zip64 ? MAX_16 : this.entries.length;
    const record = Buffer.alloc(22);
    record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    record.writeUInt16LE(0, 4);
    record.writeUInt16LE(0, 6);
    record.writeUInt16LE(count, 8);
    record.writeUInt16LE(count, 10);
    record.writeUInt32LE(zip64 ? MAX_32 : directorySize, 12);
    record.writeUInt32LE(zip64 ? MAX_32 : directoryOffset, 16);
    record.writeUInt16LE(0, 20);
    return record;
  }

  private async append(data: Buffer): Promise<void> {
    let written = 0;
    while (written < data.length) {
      const { bytesWritten } = await this.handle.write(data, written, data.length - written, this.position + written);
      written += bytesWritten;
    }
    this.position += data.length;
  }
}

function zip64ExtraHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(ZIP64_EXTRA_FIELD, 0);
  header.writeUInt16LE(dataLength, 2);
  return header;
}

function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
