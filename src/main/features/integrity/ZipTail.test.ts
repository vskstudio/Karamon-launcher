import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { hasValidZipEnd, isArchiveName } from './ZipTail.ts';

function jarBytes(): Buffer {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from('{"id":"voxy"}'));
  zip.addFile('a/B.class', Buffer.alloc(4096, 7));
  return zip.toBuffer();
}

test('reconnaît une archive saine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziptail-'));
  const file = path.join(dir, 'voxy.jar');
  fs.writeFileSync(file, jarBytes());
  assert.equal(hasValidZipEnd(file), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejette un jar de la bonne taille dont la fin est remplie de zéros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziptail-'));
  const file = path.join(dir, 'voxy.jar');
  const bytes = jarBytes();
  bytes.fill(0, Math.floor(bytes.length / 2));
  fs.writeFileSync(file, bytes);
  assert.equal(hasValidZipEnd(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejette une archive tronquée, un fichier vide ou absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziptail-'));
  const truncated = path.join(dir, 'cut.zip');
  fs.writeFileSync(truncated, jarBytes().subarray(0, 100));
  const empty = path.join(dir, 'empty.zip');
  fs.writeFileSync(empty, '');
  assert.equal(hasValidZipEnd(truncated), false);
  assert.equal(hasValidZipEnd(empty), false);
  assert.equal(hasValidZipEnd(path.join(dir, 'absent.zip')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ne contrôle que les .jar et .zip', () => {
  assert.equal(isArchiveName('mods/Voxy.JAR'), true);
  assert.equal(isArchiveName('resourcepacks/Comforts.zip'), true);
  assert.equal(isArchiveName('config/voxy.json'), false);
});
