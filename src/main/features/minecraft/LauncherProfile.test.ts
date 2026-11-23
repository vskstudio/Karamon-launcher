import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LauncherProfile } from './LauncherProfile.ts';

const SPEC = { name: 'Karamon', versionId: 'fabric-loader-0.16-1.21.1', gameDir: '/jeux/karamon', memoryMb: 8192, jvmArgs: '' };

function launcherDir(content?: string | Buffer): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-profile-'));
  const file = path.join(dir, 'launcher_profiles.json');
  if (content !== undefined) fs.writeFileSync(file, content);
  return { dir, file };
}

test('le profil Karamon est ajouté à côté des profils du joueur', () => {
  const { dir, file } = launcherDir(JSON.stringify({ profiles: { perso: { name: 'Survie 1.20', lastVersionId: '1.20.4' } }, clientToken: 'abc' }));
  new LauncherProfile(dir).ensure(SPEC);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.profiles.perso.name, 'Survie 1.20');
  assert.equal(written.clientToken, 'abc');
  assert.equal(written.profiles.Karamon.lastVersionId, SPEC.versionId);
});

test('un fichier de profils illisible est laissé tel quel au lieu d’être remplacé', () => {
  const halfWritten = '{"profiles": {"perso": {"name": "Survie 1.20", "lastVersi';
  const { dir, file } = launcherDir(halfWritten);
  assert.throws(() => new LauncherProfile(dir).ensure(SPEC), /illisible/);
  assert.equal(fs.readFileSync(file, 'utf8'), halfWritten);
});

test('un fichier de profils enregistré avec un BOM se lit', () => {
  const { dir, file } = launcherDir(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ profiles: { perso: { name: 'Survie' } } }))]));
  new LauncherProfile(dir).ensure(SPEC);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).profiles), ['perso', 'Karamon']);
});
