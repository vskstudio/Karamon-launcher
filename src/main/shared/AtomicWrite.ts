import fs from 'fs';
import path from 'path';

/**
 * Crash-safe file replacement: the data goes to a temp file in the target's own
 * directory, is flushed to disk, then renamed over the target. A power cut leaves
 * either the old file or the new one, never a zero-filled or truncated mix.
 */
export function writeFileAtomic(target: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = tempPathFor(target);
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function copyFileAtomic(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = tempPathFor(target);
  try {
    fs.copyFileSync(source, tmp);
    fsyncFile(tmp);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Flushes a file already written through another API (streams, copyFile). */
export function fsyncFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

let counter = 0;

function tempPathFor(target: string): string {
  counter = (counter + 1) % 1_000_000;
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${counter}.karamon-tmp`);
}
