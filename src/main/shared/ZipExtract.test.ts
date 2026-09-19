import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { extractZipToDir, resolveInside } from './ZipExtract.ts';

function writeZipWithoutDataDescriptor(dir: string, name: string, content: string): string {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(content));
  const buffer = zip.toBuffer();
  buffer.writeUInt16LE(buffer.readUInt16LE(6) | 8, 6);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt16LE(buffer.readUInt16LE(central + 8) | 8, central + 8);
  const zipPath = path.join(dir, 'flagged.zip');
  fs.writeFileSync(zipPath, buffer);
  return zipPath;
}

test('extrait une archive dont le bit de descripteur est posé sans descripteur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipextract-'));
  const zipPath = writeZipWithoutDataDescriptor(dir, 'mods/karamon.jar', 'contenu du jar');
  const dest = path.join(dir, 'out');

  assert.throws(() => new AdmZip(zipPath).getEntries()[0].getData(), /descriptor/i);
  extractZipToDir(zipPath, dest);

  assert.equal(fs.readFileSync(path.join(dest, 'mods', 'karamon.jar'), 'utf8'), 'contenu du jar');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuse une entrée qui sort du dossier de destination', () => {
  assert.throws(() => resolveInside('/tmp/root', '../evil.txt'), /path traversal/);
});
