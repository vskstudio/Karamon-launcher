import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { GameRunningError } from './MinecraftLauncher.ts';
import { ConfigNotReadYetError } from '../config/Config.ts';
import { PackServer, jarOf, launcherHarness, publishPack, zipOf } from '../modpack/PackServer.fixture.ts';

const quiet = (): void => undefined;

test('synchroniser, réparer ou basculer un réglage pendant que le jeu tourne ne touche pas au dossier', async () => {
  const server = new PackServer();
  const jars = { 'demo-1.0.jar': jarOf('demo'), 'sodium-fabric-0.8.jar': jarOf('sodium') };
  publishPack(server, { jars });
  const h = launcherHarness(server);
  await h.sync();
  await h.play();
  server.files.set('mods.zip', zipOf({ ...jars, 'new-1.0.jar': jarOf('new') }));
  server.resetStats();

  await assert.rejects(h.launcher.syncOnly(h.config, quiet, quiet), GameRunningError);
  await assert.rejects(h.launcher.repair(h.config, quiet, quiet), GameRunningError);
  h.config.disableSodium = true;
  const toggled: string[] = [];
  await h.launcher.applyModToggles({ ...h.config, disableSodium: false }, h.config, (line) => toggled.push(line));
  assert.deepEqual(server.stats.heads, []);
  assert.ok(!fs.existsSync(path.join(h.game, 'mods', 'new-1.0.jar')));
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'sodium-fabric-0.8.jar')));
  assert.equal(toggled.length, 1);

  h.games[0].exit(0);
  assert.equal(h.launcher.isRunning(), false);
  await h.sync();
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'new-1.0.jar')));
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'sodium-fabric-0.8.jar.disabled')));
  h.cleanup();
});

test('synchroniser, réparer et jouer sur le même dossier passent l’un après l’autre', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'big-1.0.jar': jarOf('big', 200) } });
  const h = launcherHarness(server);
  const speakers: string[] = [];
  const speaking = (name: string) => (): void => {
    if (speakers.at(-1) !== name) speakers.push(name);
  };
  const release = server.holdDownloads();

  const sync = h.launcher.syncOnly(h.config, speaking('sync'), quiet);
  const repair = h.launcher.repair(h.config, speaking('repair'), quiet);
  const play = h.play({ onStatus: speaking('play') });
  await sleep(30);
  release();
  await Promise.all([sync, repair, play]);

  assert.deepEqual(speakers, ['sync', 'repair', 'play']);
  h.games[0].exit(0);
  h.cleanup();
});

test('une deuxième demande de synchronisation pendant la première la rejoint au lieu d’en lancer une autre', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'big-1.0.jar': jarOf('big', 50) } });
  const h = launcherHarness(server);
  const release = server.holdDownloads();
  const first = h.launcher.syncOnly(h.config, quiet, quiet);
  const second = h.launcher.syncOnly(h.config, quiet, quiet);
  await sleep(10);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(server.stats.heads.filter((name) => name === 'mods.zip'), ['mods.zip']);
  h.cleanup();
});

test('deux enregistrements rapprochés des bascules finissent sur l’état de la dernière config', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'sodium-fabric-0.8.jar': jarOf('sodium'), 'voxy-0.2.jar': jarOf('voxy'), 'lib-1.jar': jarOf('lib') } });
  const h = launcherHarness(server);
  await h.sync();
  const c0 = { ...h.config };
  const c1 = { ...c0, potatoMode: true, disableSodium: true };
  const c2 = { ...c1, disableSodium: false };
  let saved = c1;
  const first = h.launcher.applyModToggles(c0, c1, quiet, () => saved);
  saved = c2;
  const second = h.launcher.applyModToggles(c1, c2, quiet, () => saved);
  await Promise.all([first, second]);

  const mods = fs.readdirSync(path.join(h.game, 'mods'));
  assert.ok(mods.includes('sodium-fabric-0.8.jar'));
  assert.ok(!mods.includes('sodium-fabric-0.8.jar.disabled'));
  assert.ok(mods.includes('voxy-0.2.jar.disabled'));
  h.cleanup();
});

test('une bascule des mods ne touche pas au dossier tant que la config n’a pas été lue', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'sodium-fabric-0.8.jar': jarOf('sodium'), 'lib-1.jar': jarOf('lib') } });
  const h = launcherHarness(server);
  await h.sync();
  const before = { ...h.config };
  const after = { ...before, disableSodium: true };

  await assert.rejects(
    h.launcher.applyModToggles(before, after, quiet, () => {
      throw new ConfigNotReadYetError();
    }),
    ConfigNotReadYetError,
  );

  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'sodium-fabric-0.8.jar')));
  h.cleanup();
});
