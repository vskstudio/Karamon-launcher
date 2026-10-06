import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import { ZipReader } from './ZipReader.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zipreader-'));
}

test('lit chaque entrée, stockée ou compressée, comme adm-zip', () => {
  const dir = tmp();
  const zip = new AdmZip();
  const big = Buffer.alloc(300_000, 'karamon ');
  zip.addFile('mods/a.jar', big);
  zip.addFile('mods/b.jar', Buffer.from('petit jar'));
  zip.addFile('config/', Buffer.alloc(0));
  const zipPath = path.join(dir, 'pack.zip');
  zip.writeZip(zipPath);

  ZipReader.with(zipPath, (reader) => {
    const names = reader.entries.map((e) => e.entryName).sort();
    assert.deepEqual(names, ['config/', 'mods/a.jar', 'mods/b.jar']);
    const byName = new Map(reader.entries.map((e) => [e.entryName, e]));
    assert.ok(byName.get('config/')!.isDirectory);
    assert.ok(reader.read(byName.get('mods/a.jar')!).equals(big));
    assert.equal(reader.read(byName.get('mods/b.jar')!).toString(), 'petit jar');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lit une entrée dont le bit de descripteur est posé sans descripteur', () => {
  const dir = tmp();
  const zip = new AdmZip();
  zip.addFile('mods/karamon.jar', Buffer.from('contenu du jar'));
  const buffer = zip.toBuffer();
  buffer.writeUInt16LE(buffer.readUInt16LE(6) | 8, 6);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt16LE(buffer.readUInt16LE(central + 8) | 8, central + 8);
  const zipPath = path.join(dir, 'flagged.zip');
  fs.writeFileSync(zipPath, buffer);

  ZipReader.with(zipPath, (reader) => {
    assert.equal(reader.read(reader.entries[0]).toString(), 'contenu du jar');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuse une entrée abîmée (CRC faux)', () => {
  const dir = tmp();
  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('aaaaaaaaaa'), '', 0);
  const entry = zip.getEntries()[0];
  entry.header.method = 0;
  const buffer = zip.toBuffer();
  const at = buffer.indexOf(Buffer.from('aaaaaaaaaa'));
  assert.ok(at > 0);
  buffer.write('b', at);
  const zipPath = path.join(dir, 'crc.zip');
  fs.writeFileSync(zipPath, buffer);

  ZipReader.with(zipPath, (reader) => {
    assert.throws(() => reader.read(reader.entries[0]), /Checksum zip invalide|corrompue/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuse un fichier qui n\'est pas un zip ou dont la fin manque', () => {
  const dir = tmp();
  const notZip = path.join(dir, 'zeros.zip');
  fs.writeFileSync(notZip, Buffer.alloc(4096));
  assert.throws(() => ZipReader.open(notZip), /fin d'archive introuvable/);

  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('a'));
  const full = zip.toBuffer();
  const truncated = path.join(dir, 'cut.zip');
  fs.writeFileSync(truncated, full.subarray(0, full.length - 10));
  assert.throws(() => ZipReader.open(truncated));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lit un zip ZIP64 (tailles et offsets dans le champ extra)', () => {
  const dir = tmp();
  const name = Buffer.from('big.jar');
  const data = Buffer.from('donnees zip64');
  const compressed = zlib.deflateRawSync(data);
  const crc = zlib.crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(45, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(0xffffffff, 18);
  local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(20, 28);
  const localExtra = Buffer.alloc(20);
  localExtra.writeUInt16LE(1, 0);
  localExtra.writeUInt16LE(16, 2);
  localExtra.writeBigUInt64LE(BigInt(data.length), 4);
  localExtra.writeBigUInt64LE(BigInt(compressed.length), 12);
  const localPart = Buffer.concat([local, name, localExtra, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(45, 4);
  central.writeUInt16LE(45, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(28, 30);
  central.writeUInt32LE(0xffffffff, 42);
  const centralExtra = Buffer.alloc(28);
  centralExtra.writeUInt16LE(1, 0);
  centralExtra.writeUInt16LE(24, 2);
  centralExtra.writeBigUInt64LE(BigInt(data.length), 4);
  centralExtra.writeBigUInt64LE(BigInt(compressed.length), 12);
  centralExtra.writeBigUInt64LE(0n, 20);
  const centralPart = Buffer.concat([central, name, centralExtra]);

  const cdOffset = localPart.length;
  const z64 = Buffer.alloc(56);
  z64.writeUInt32LE(0x06064b50, 0);
  z64.writeBigUInt64LE(44n, 4);
  z64.writeUInt16LE(45, 12);
  z64.writeUInt16LE(45, 14);
  z64.writeBigUInt64LE(1n, 24);
  z64.writeBigUInt64LE(1n, 32);
  z64.writeBigUInt64LE(BigInt(centralPart.length), 40);
  z64.writeBigUInt64LE(BigInt(cdOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(cdOffset + centralPart.length), 8);
  locator.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);

  const zipPath = path.join(dir, 'z64.zip');
  fs.writeFileSync(zipPath, Buffer.concat([localPart, centralPart, z64, locator, eocd]));
  ZipReader.with(zipPath, (reader) => {
    assert.equal(reader.entries.length, 1);
    assert.equal(reader.entries[0].entryName, 'big.jar');
    assert.equal(reader.read(reader.entries[0]).toString(), 'donnees zip64');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractTo écrit en flux, vérifie le CRC et ne laisse pas de fichier temporaire', async () => {
  const dir = tmp();
  const zip = new AdmZip();
  const big = Buffer.alloc(2_000_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  zip.addFile('mods/big.jar', big);
  zip.addFile('mods/vide.txt', Buffer.alloc(0));
  zip.addFile('mods/stocke.bin', Buffer.from('stocke'), '', 0);
  zip.getEntry('mods/stocke.bin')!.header.method = 0;
  const zipPath = path.join(dir, 'pack.zip');
  zip.writeZip(zipPath);
  const out = path.join(dir, 'out');

  await ZipReader.withAsync(zipPath, async (reader) => {
    for (const entry of reader.entries) {
      await reader.extractTo(entry, path.join(out, entry.entryName), { durable: true });
    }
  });
  assert.ok(fs.readFileSync(path.join(out, 'mods', 'big.jar')).equals(big));
  assert.equal(fs.readFileSync(path.join(out, 'mods', 'vide.txt')).length, 0);
  assert.equal(fs.readFileSync(path.join(out, 'mods', 'stocke.bin'), 'utf8'), 'stocke');
  assert.deepEqual(fs.readdirSync(path.join(out, 'mods')).sort(), ['big.jar', 'stocke.bin', 'vide.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractTo garde l\'ancien fichier si l\'entrée est abîmée', async () => {
  const dir = tmp();
  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('aaaaaaaaaa'), '', 0);
  zip.getEntries()[0].header.method = 0;
  const buffer = zip.toBuffer();
  buffer.write('b', buffer.indexOf(Buffer.from('aaaaaaaaaa')));
  const zipPath = path.join(dir, 'crc.zip');
  fs.writeFileSync(zipPath, buffer);
  const target = path.join(dir, 'out', 'a.txt');
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(target, 'ancien');

  await assert.rejects(
    ZipReader.withAsync(zipPath, (reader) => reader.extractTo(reader.entries[0], target)),
    /Checksum zip invalide/,
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'ancien');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['a.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ferme le fichier même si le traitement échoue', () => {
  const dir = tmp();
  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('a'));
  const zipPath = path.join(dir, 'a.zip');
  zip.writeZip(zipPath);
  let kept: ZipReader | null = null;
  assert.throws(() =>
    ZipReader.with(zipPath, (reader) => {
      kept = reader;
      throw new Error('boom');
    }),
  /boom/);
  assert.throws(() => kept!.read(kept!.entries[0]), /fermé/);
  fs.rmSync(dir, { recursive: true, force: true });
});
