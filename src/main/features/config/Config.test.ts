import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config } from './Config.ts';

function tempConfig(raw?: object): Config {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-config-'));
  const file = path.join(dir, 'config.json');
  if (raw) fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  return new Config(file).load();
}

test('an old config without the second game memory gets 6 Go', () => {
  assert.equal(tempConfig({ memoryMb: 8192 }).get().secondInstanceMemoryMb, 6144);
});

test('the second game memory is saved and read back', () => {
  const config = tempConfig();
  config.set({ secondInstanceMemoryMb: 4096 });
  assert.equal(config.get().secondInstanceMemoryMb, 4096);
  assert.equal(config.get().memoryMb, 12288);
});

test('a second game memory out of bounds falls back to 6 Go', () => {
  assert.equal(tempConfig({ secondInstanceMemoryMb: 100 }).get().secondInstanceMemoryMb, 6144);
});
