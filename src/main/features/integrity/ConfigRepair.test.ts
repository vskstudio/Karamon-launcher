import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { repairCorruptConfigs } from './ConfigRepair.ts';
import { GameInstance } from '../../shared/GameInstance.ts';

function write(root: string, rel: string, data: string | Buffer): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

const allNul = (data: Buffer): boolean => data.length > 0 && data.every((b) => b === 0);

test('ne répare que les fichiers entièrement NUL de config/, defaultoptions.journal.json et resourcepacks/*.rpo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-repair-'));
  write(dir, 'config/a.json', Buffer.alloc(300));
  write(dir, 'config/deep/b.json5', Buffer.alloc(70_000));
  write(dir, 'config/ok.json', '{"ok":true}');
  const almost = Buffer.alloc(512);
  almost[511] = 0x7d;
  write(dir, 'config/almost.json', almost);
  write(dir, 'config/empty.json', '');
  write(dir, 'config/huge.bin', Buffer.alloc(5 * 1024 * 1024 + 1));
  write(dir, 'defaultoptions.journal.json', Buffer.alloc(40));
  write(dir, 'resourcepacks/Comforts.zip.rpo', Buffer.alloc(12));
  write(dir, 'resourcepacks/Comforts.zip', Buffer.alloc(12));
  write(dir, 'resourcepacks/sub/x.rpo', Buffer.alloc(12));
  write(dir, 'options.txt', Buffer.alloc(12));
  write(dir, 'saves/world/level.dat', Buffer.alloc(12));

  const result = repairCorruptConfigs(new GameInstance(dir), new Date(2026, 9, 5, 23, 59));
  assert.deepEqual(result.repaired, [
    'config/a.json',
    'config/deep/b.json5',
    'defaultoptions.journal.json',
    'resourcepacks/Comforts.zip.rpo',
  ]);
  assert.equal(result.backupDir, path.join(dir, 'config-corrompues-2026-10-05'));
  for (const kept of ['config/ok.json', 'config/almost.json', 'config/empty.json', 'config/huge.bin', 'resourcepacks/Comforts.zip', 'options.txt']) {
    assert.ok(fs.existsSync(path.join(dir, kept)), kept);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('déplace les fichiers abîmés et remet la version du pack quand elle existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-repair-'));
  const instance = new GameInstance(dir);
  write(dir, 'config/lumymon.json', Buffer.alloc(11));
  write(dir, 'config/voxy.json', Buffer.alloc(20));
  write(dir, 'config/ok.json', '{"ok":true}');
  const zip = new AdmZip();
  zip.addFile('config/lumymon.json', Buffer.from('{"ok":true}'));
  zip.writeZip(instance.overridesArchive);

  const now = new Date(2026, 9, 5);
  const result = repairCorruptConfigs(instance, now);

  assert.deepEqual(result.repaired, ['config/lumymon.json', 'config/voxy.json']);
  assert.deepEqual(result.restored, ['config/lumymon.json']);
  assert.equal(fs.readFileSync(path.join(dir, 'config/lumymon.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(dir, 'config/voxy.json')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'config/ok.json'), 'utf8'), '{"ok":true}');
  const backup = path.join(dir, 'config-corrompues-2026-10-05', 'config');
  assert.ok(allNul(fs.readFileSync(path.join(backup, 'voxy.json'))));
  assert.ok(allNul(fs.readFileSync(path.join(backup, 'lumymon.json'))));

  assert.deepEqual(repairCorruptConfigs(instance, now).repaired, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
