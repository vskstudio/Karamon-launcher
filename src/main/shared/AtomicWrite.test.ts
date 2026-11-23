import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeFileAtomic } from './AtomicWrite.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
}

test('remplace le contenu sans laisser de fichier temporaire', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'config', 'mod.json');
  writeFileAtomic(target, '{"a":1}');
  writeFileAtomic(target, Buffer.from('{"a":2}'));
  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['mod.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});
