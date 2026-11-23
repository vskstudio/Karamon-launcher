import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { Backup } from './Backup.ts';

function gameWithWorld(): { root: string; gameDir: string; regionBytes: Buffer } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-backup-'));
  const gameDir = path.join(root, 'game');
  const region = path.join(gameDir, 'saves', 'Monde été', 'region');
  fs.mkdirSync(region, { recursive: true });
  fs.mkdirSync(path.join(gameDir, 'saves', 'Monde été', 'datapacks'));
  const regionBytes = crypto.randomBytes(3 * 1024 * 1024);
  fs.writeFileSync(path.join(region, 'r.0.0.mca'), regionBytes);
  fs.writeFileSync(path.join(gameDir, 'saves', 'Monde été', 'level.dat'), 'level');
  fs.mkdirSync(path.join(gameDir, 'config'));
  fs.writeFileSync(path.join(gameDir, 'config', 'sodium-options.json'), '{"quality":{}}'.repeat(1000));
  return { root, gameDir, regionBytes };
}

test('la sauvegarde des mondes laisse tourner le processus et produit un zip complet', async () => {
  const { root, gameDir, regionBytes } = gameWithWorld();
  const backup = new Backup(path.join(root, 'data'), () => false);
  let eventLoopRan = false;
  setImmediate(() => {
    eventLoopRan = true;
  });

  const entry = await backup.create(gameDir);

  assert.ok(eventLoopRan, 'la boucle d’évènements a tourné pendant la sauvegarde');
  const zip = new AdmZip(entry.path);
  assert.deepEqual(zip.readFile('saves/Monde été/region/r.0.0.mca'), regionBytes);
  assert.equal(zip.readAsText('saves/Monde été/level.dat'), 'level');
  assert.equal(zip.readAsText('config/sodium-options.json'), '{"quality":{}}'.repeat(1000));
  assert.ok(zip.getEntry('saves/Monde été/datapacks/')?.isDirectory);
  assert.deepEqual(backup.list().backups.map((b) => b.name), [entry.name]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('la sauvegarde est refusée pendant que le jeu écrit les mondes', async () => {
  const { root, gameDir } = gameWithWorld();
  const backup = new Backup(path.join(root, 'data'), () => true);
  await assert.rejects(backup.create(gameDir), /Ferme le jeu/);
  assert.deepEqual(backup.list().backups, []);
  fs.rmSync(root, { recursive: true, force: true });
});
