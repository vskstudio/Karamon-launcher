import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { FileVerifier, INTEGRITY_CACHE_FILE } from './FileVerifier.ts';

const sha1 = (data: Buffer | string): string => crypto.createHash('sha1').update(data).digest('hex');

function gameDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-'));
}

test('compare la taille puis le SHA-1 quand il est publié', async () => {
  const dir = gameDir();
  const file = path.join(dir, 'shaderpacks', 'shader.txt');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'shader');
  const verifier = new FileVerifier(dir);
  assert.equal(await verifier.isIntact(file, { size: 6, sha1: sha1('shader') }), true);
  assert.equal(await verifier.isIntact(file, { size: 7 }), false);
  assert.equal(await verifier.isIntact(file, { size: 6, sha1: sha1('autre!') }), false);
  assert.equal(await verifier.isIntact(path.join(dir, 'absent.txt'), { size: 1 }), false);
  assert.deepEqual(verifier.damaged, ['shaderpacks/shader.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('réutilise le cache tant que taille et date ne bougent pas, sauf en vérification complète', async () => {
  const dir = gameDir();
  const file = path.join(dir, 'data.bin');
  const stamp = 1_700_000_000;
  fs.writeFileSync(file, 'AAAA');
  fs.utimesSync(file, stamp, stamp);
  const expected = { size: 4, sha1: sha1('AAAA') };
  const first = new FileVerifier(dir);
  assert.equal(await first.isIntact(file, expected), true);
  first.save();
  assert.ok(fs.existsSync(path.join(dir, INTEGRITY_CACHE_FILE)));

  fs.writeFileSync(file, 'BBBB');
  fs.utimesSync(file, stamp, stamp);

  assert.equal(await new FileVerifier(dir).isIntact(file, expected), true);
  assert.equal(await new FileVerifier(dir, { force: true }).isIntact(file, expected), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('détecte un jar à la fin remplie de zéros malgré un hash en cache', async () => {
  const dir = gameDir();
  const file = path.join(dir, 'mods', 'voxy.jar');
  fs.mkdirSync(path.dirname(file));
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from('{"id":"voxy"}'));
  const bytes = zip.toBuffer();
  const stamp = 1_700_000_000;
  fs.writeFileSync(file, bytes);
  fs.utimesSync(file, stamp, stamp);
  const expected = { size: bytes.length, sha1: sha1(bytes) };
  const first = new FileVerifier(dir);
  assert.equal(await first.isIntact(file, expected), true);
  first.save();

  fs.writeFileSync(file, Buffer.concat([bytes.subarray(0, 10), Buffer.alloc(bytes.length - 10)]));
  fs.utimesSync(file, stamp, stamp);

  assert.equal(await new FileVerifier(dir).isIntact(file, expected), false);
  assert.equal(await new FileVerifier(dir).isIntact(file, { size: bytes.length }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
