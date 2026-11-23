import fs from 'fs';
import path from 'path';

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

export function fsyncFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

let counter = 0;

export function tempPathFor(target: string): string {
  counter = (counter + 1) % 1_000_000;
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${counter}.karamon-tmp`);
}
