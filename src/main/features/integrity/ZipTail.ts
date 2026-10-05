import fs from 'fs';

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_MARKER = 0xffffffff;

export interface ZipEnd {
  /** Absolute offset of the central directory, or -1 for a zip64 archive. */
  centralOffset: number;
  centralSize: number;
}

/**
 * Finds the end-of-central-directory record in the last bytes of an archive.
 * A jar whose tail was zero-filled by a crash ("zip END header not found") has none.
 */
export function findZipEnd(tail: Buffer, fileSize: number): ZipEnd | null {
  if (tail.length < EOCD_SIZE || fileSize < tail.length) return null;
  const tailStart = fileSize - tail.length;
  const lowest = Math.max(0, tail.length - EOCD_SIZE - MAX_COMMENT);
  for (let i = tail.length - EOCD_SIZE; i >= lowest; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(i + 20);
    if (i + EOCD_SIZE + commentLength > tail.length) continue;
    const centralSize = tail.readUInt32LE(i + 12);
    const centralOffset = tail.readUInt32LE(i + 16);
    if (centralOffset === ZIP64_MARKER || centralSize === ZIP64_MARKER) {
      const locator = i - ZIP64_LOCATOR_SIZE;
      if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
        return { centralOffset: -1, centralSize: 0 };
      }
      continue;
    }
    if (centralOffset + centralSize > tailStart + i) continue;
    return { centralOffset, centralSize };
  }
  return null;
}

/** Cheap structural check: reads at most ~64 KB from the end plus 4 bytes. */
export function hasValidZipEnd(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, EOCD_SIZE + MAX_COMMENT);
    const tail = Buffer.alloc(length);
    fs.readSync(fd, tail, 0, length, size - length);
    const end = findZipEnd(tail, size);
    if (!end) return false;
    if (end.centralOffset < 0 || end.centralSize === 0) return true;
    const head = Buffer.alloc(4);
    if (fs.readSync(fd, head, 0, 4, end.centralOffset) !== 4) return false;
    return head.readUInt32LE(0) === CENTRAL_SIGNATURE;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

export function isArchiveName(name: string): boolean {
  return /\.(jar|zip)$/i.test(name);
}
