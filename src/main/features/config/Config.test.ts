import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { Config, ConfigNotReadYetError } from './Config.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';
import { cannotMakeFilesInaccessible, makeAccessible, makeInaccessible } from '../../shared/Inaccessible.fixture.ts';

function tempConfig(raw?: object): Config {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  if (raw) fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  return new Config(file, () => {}).load();
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

test('the automatic report consent is disabled for old configs', () => {
  assert.equal(tempConfig({ memoryMb: 8192 }).get().autoSendReports, false);
});

test('a config that does not parse is kept aside instead of being overwritten by the defaults', () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  const truncated = '{"mcGameDir": "D:\\\\Jeux\\\\Karamon", "memoryMb": 8';
  fs.writeFileSync(file, truncated, 'utf8');
  const logged: string[] = [];

  const config = new Config(file, (message) => logged.push(message)).load();
  config.set({ potatoMode: true });

  const aside = fs.readdirSync(dir).filter((name) => name.startsWith('config.json.illisible-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), truncated);
  assert.equal(new Config(file, () => {}).load().get().potatoMode, true);
  assert.ok(logged.some((message) => message.includes('illisible')));
});

test('the automatic report consent is saved and read back', () => {
  const config = tempConfig();
  config.set({ autoSendReports: true });
  assert.equal(config.get().autoSendReports, true);
});

test('a config that cannot be read at startup is reread before saving, never replaced by the defaults', { skip: cannotMakeFilesInaccessible }, () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ mcGameDir: 'D:\\Jeux\\Karamon', memoryMb: 8192 }), 'utf8');
  const logged: string[] = [];

  makeInaccessible(file);
  const config = new Config(file, (message) => logged.push(message)).load();
  makeAccessible(file);
  config.set({ potatoMode: true });

  const saved = new Config(file, () => {}).load().get();
  assert.equal(saved.mcGameDir, 'D:\\Jeux\\Karamon');
  assert.equal(saved.memoryMb, 8192);
  assert.equal(saved.potatoMode, true);
  assert.equal(config.get().mcGameDir, 'D:\\Jeux\\Karamon');
  assert.ok(!logged.some((message) => message.includes('gardera l\'ancien fichier')));
});

test('a config that stays unreadable refuses to save, and nothing changes in memory or on disk', { skip: cannotMakeFilesInaccessible }, () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  const original = JSON.stringify({ mcGameDir: 'D:\\Jeux\\Karamon' });
  fs.writeFileSync(file, original, 'utf8');

  makeInaccessible(file);
  const config = new Config(file, () => {}).load();
  assert.throws(() => config.set({ potatoMode: true }), ConfigNotReadYetError);
  assert.equal(config.get().potatoMode, false);
  makeAccessible(file);

  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
  const reread = config.get();
  assert.equal(reread.mcGameDir, 'D:\\Jeux\\Karamon');
  assert.equal(reread.potatoMode, false);
});

test('a config that could not be read at startup is used as soon as it can be read again', { skip: cannotMakeFilesInaccessible }, () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ mcGameDir: 'D:\\Jeux\\Karamon' }), 'utf8');

  makeInaccessible(file);
  const config = new Config(file, () => {}).load();
  assert.equal(config.get().mcGameDir, '');
  makeAccessible(file);

  assert.equal(config.get().mcGameDir, 'D:\\Jeux\\Karamon');
});

test('the config refuses to be used for installing while its file cannot be read, then serves it', { skip: cannotMakeFilesInaccessible }, () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ mcGameDir: 'D:\\Jeux\\Karamon' }), 'utf8');

  makeInaccessible(file);
  const config = new Config(file, () => {}).load();
  assert.throws(() => config.getRead(), ConfigNotReadYetError);
  makeAccessible(file);

  assert.equal(config.getRead().mcGameDir, 'D:\\Jeux\\Karamon');
});

test('a config that does not parse is still usable with the defaults', () => {
  const dir = makeTempDir('karamon-config-');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"mcGameDir": "D:', 'utf8');
  assert.equal(new Config(file, () => {}).load().getRead().mcGameDir, '');
});
