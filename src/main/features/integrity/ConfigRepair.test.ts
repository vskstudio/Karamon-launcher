import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  backupDirName,
  findNulFiles,
  isAllNul,
  isScannedPath,
  MAX_SCANNED_BYTES,
  repairCorruptConfigs,
  repairMessage,
} from './ConfigRepair.ts';

function write(root: string, rel: string, data: string | Buffer): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

test('un fichier n’est corrompu que s’il est non vide et entièrement NUL', () => {
  assert.equal(isAllNul(Buffer.alloc(0)), false);
  assert.equal(isAllNul(Buffer.alloc(512)), true);
  assert.equal(isAllNul(Buffer.from('{}')), false);
  const almost = Buffer.alloc(512);
  almost[511] = 0x7d;
  assert.equal(isAllNul(almost), false);
});

test('ne scanne que config/, defaultoptions.journal.json et resourcepacks/*.rpo', () => {
  assert.equal(isScannedPath('config/voxy/voxy.json'), true);
  assert.equal(isScannedPath('defaultoptions.journal.json'), true);
  assert.equal(isScannedPath('resourcepacks/Comforts.zip.rpo'), true);
  assert.equal(isScannedPath('resourcepacks/Comforts.zip'), false);
  assert.equal(isScannedPath('resourcepacks/sub/x.rpo'), false);
  assert.equal(isScannedPath('options.txt'), false);
  assert.equal(isScannedPath('saves/world/level.dat'), false);
});

test('nomme le dossier de sauvegarde avec la date du jour', () => {
  assert.equal(backupDirName(new Date(2026, 9, 5, 23, 59)), 'config-corrompues-2026-10-05');
  assert.equal(repairMessage(62), '62 fichiers de configuration abîmés ont été réparés.');
});

test('trouve les fichiers NUL et ignore les fichiers sains, vides ou trop gros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-repair-'));
  write(dir, 'config/a.json', Buffer.alloc(300));
  write(dir, 'config/deep/b.json5', Buffer.alloc(70_000));
  write(dir, 'config/ok.json', '{"ok":true}');
  write(dir, 'config/empty.json', '');
  write(dir, 'config/huge.bin', Buffer.alloc(MAX_SCANNED_BYTES + 1));
  write(dir, 'defaultoptions.journal.json', Buffer.alloc(40));
  write(dir, 'resourcepacks/Comforts.zip.rpo', Buffer.alloc(12));
  write(dir, 'resourcepacks/Comforts.zip', Buffer.alloc(12));
  write(dir, 'options.txt', Buffer.alloc(12));
  assert.deepEqual(findNulFiles(dir), [
    'config/a.json',
    'config/deep/b.json5',
    'defaultoptions.journal.json',
    'resourcepacks/Comforts.zip.rpo',
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('déplace les fichiers abîmés et remet la version du pack quand elle existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-repair-'));
  write(dir, 'config/lumymon.json', Buffer.alloc(11));
  write(dir, 'config/voxy.json', Buffer.alloc(20));
  write(dir, 'config/ok.json', '{"ok":true}');
  const overrides = path.join(dir, '.karamon-overrides.zip');
  const zip = new AdmZip();
  zip.addFile('config/lumymon.json', Buffer.from('{"ok":true}'));
  zip.writeZip(overrides);

  const now = new Date(2026, 9, 5);
  const result = repairCorruptConfigs(dir, overrides, now);

  assert.deepEqual(result.repaired, ['config/lumymon.json', 'config/voxy.json']);
  assert.deepEqual(result.restored, ['config/lumymon.json']);
  assert.equal(result.backupDir, path.join(dir, 'config-corrompues-2026-10-05'));
  assert.equal(fs.readFileSync(path.join(dir, 'config/lumymon.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(dir, 'config/voxy.json')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'config/ok.json'), 'utf8'), '{"ok":true}');
  const backup = path.join(dir, 'config-corrompues-2026-10-05', 'config');
  assert.ok(isAllNul(fs.readFileSync(path.join(backup, 'voxy.json'))));
  assert.ok(isAllNul(fs.readFileSync(path.join(backup, 'lumymon.json'))));

  assert.deepEqual(repairCorruptConfigs(dir, overrides, now).repaired, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
