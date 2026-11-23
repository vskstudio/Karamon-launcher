import { after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const created: string[] = [];

after(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}
