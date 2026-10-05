import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { copyFileAtomic, writeFileAtomic } from './AtomicWrite.ts';

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

test('copie un fichier par remplacement atomique', () => {
  const dir = tmpDir();
  const source = path.join(dir, 'source.zip');
  const target = path.join(dir, 'out', 'pack.zip');
  fs.writeFileSync(source, 'zip-bytes');
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(target, 'old');
  copyFileAtomic(source, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'zip-bytes');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['pack.zip']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('garde l’ancien fichier si l’écriture échoue', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'keep.txt');
  fs.writeFileSync(target, 'intact');
  assert.throws(() => copyFileAtomic(path.join(dir, 'absent'), target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'intact');
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});
