import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import AdmZip from 'adm-zip';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;
const DEFLATED = 8;

export interface ZipExtractOptions {
  stripCommonTopLevelFolder?: boolean;
  exclude?: string[];
}

export function readEntryData(zipBuffer: Buffer, entry: AdmZip.IZipEntry): Buffer {
  try {
    return entry.getData();
  } catch (error) {
    if (!isDescriptorError(error)) throw error;
    return inflateEntryFromCentralDirectory(zipBuffer, entry);
  }
}

function isDescriptorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('descriptor') || message.includes('Descriptor');
}

function inflateEntryFromCentralDirectory(zipBuffer: Buffer, entry: AdmZip.IZipEntry): Buffer {
  const { offset, compressedSize, size, method } = entry.header;
  if (zipBuffer.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Entrée zip illisible: ${entry.entryName}`);
  }
  const nameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraLength = zipBuffer.readUInt16LE(offset + 28);
  const start = offset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  const compressed = zipBuffer.subarray(start, start + compressedSize);
  if (compressed.length !== compressedSize) {
    throw new Error(`Entrée zip tronquée: ${entry.entryName}`);
  }
  if (method !== STORED && method !== DEFLATED) {
    throw new Error(`Compression zip non supportée (${method}): ${entry.entryName}`);
  }
  const data = method === STORED ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
  if (data.length !== size) {
    throw new Error(`Entrée zip corrompue: ${entry.entryName}`);
  }
  if (zlib.crc32 && zlib.crc32(data) !== entry.header.crc) {
    throw new Error(`Checksum zip invalide: ${entry.entryName}`);
  }
  return data;
}

export function extractZipToDir(
  zipPath: string,
  destDir: string,
  { stripCommonTopLevelFolder = false, exclude = [] }: ZipExtractOptions = {},
): void {
  const zipBuffer = fs.readFileSync(zipPath);
  const entries = new AdmZip(zipBuffer).getEntries();
  const stripPrefix = stripCommonTopLevelFolder ? commonTopLevelPrefix(entries) : '';
  fs.mkdirSync(destDir, { recursive: true });
  const root = path.resolve(destDir);

  for (const entry of entries) {
    const entryName = entry.entryName;
    if (exclude.some((prefix) => entryName.startsWith(prefix))) continue;
    const relName = stripPrefix ? entryName.slice(stripPrefix.length) : entryName;
    if (!relName) continue;

    const target = resolveInside(root, relName, entryName);
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, readEntryData(zipBuffer, entry));
  }
}

export function resolveInside(rootDir: string, relPath: string, label = relPath): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Chemin refusé (path traversal): ${label}`);
  }
  return target;
}

export function commonTopLevelPrefix(entries: { entryName: string }[]): string {
  let prefix: string | null = null;
  for (const entry of entries) {
    const name = entry.entryName;
    const slash = name.indexOf('/');
    if (slash === -1) return '';
    const top = name.slice(0, slash + 1);
    if (prefix === null) prefix = top;
    else if (prefix !== top) return '';
  }
  return prefix ?? '';
}
