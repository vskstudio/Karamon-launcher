import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileLog } from './FileLog.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filelog-'));
}

test('écrit une ligne horodatée par message, même sur plusieurs lignes', () => {
  const dir = tmp();
  const log = new FileLog(path.join(dir, 'logs'));
  log.info('Synchronisation du pack');
  log.error('Mise à jour', new Error('réseau\ncoupé'));
  const lines = fs.readFileSync(log.file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT.* \[info\] Synchronisation du pack$/);
  assert.match(lines[1], /\[error\] Mise à jour: Error: réseau ⏎ coupé/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('garde une seule copie tournée quand le fichier dépasse la limite', () => {
  const dir = tmp();
  const log = new FileLog(dir, 200);
  for (let i = 0; i < 20; i++) log.info(`message numéro ${i}`);
  const current = fs.readFileSync(path.join(dir, 'launcher.log'), 'utf8');
  const old = fs.readFileSync(path.join(dir, 'launcher.old.log'), 'utf8');
  assert.ok(Buffer.byteLength(current) <= 200);
  assert.ok(Buffer.byteLength(old) <= 200);
  assert.match(current, /message numéro 19/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['launcher.log', 'launcher.old.log']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('masque les jetons', () => {
  const dir = tmp();
  const log = new FileLog(dir);
  log.warn('réponse {"access_token":"eyJhbGciOiJIUzI1NiJ9.abcdefghijkl"} Bearer abcdefghijklmnop1234');
  const text = fs.readFileSync(log.file, 'utf8');
  assert.ok(!text.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!text.includes('abcdefghijklmnop1234'));
  assert.match(text, /\[masqué\].*\[masqué\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ne lève jamais d\'erreur si le dossier est inutilisable', () => {
  const dir = tmp();
  const blocker = path.join(dir, 'pas-un-dossier');
  fs.writeFileSync(blocker, 'x');
  const log = new FileLog(blocker);
  assert.doesNotThrow(() => log.info('rien'));
  fs.rmSync(dir, { recursive: true, force: true });
});
