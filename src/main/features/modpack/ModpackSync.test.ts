import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';
import { PackServer, RELEASE_BASE, jarOf, launcherHarness, publishPack, sha1Of, zipOf } from './PackServer.fixture.ts';
import { ModpackSync, type SyncRequest } from './ModpackSync.ts';
import { ResourceChangedError } from '../../shared/HttpClient.ts';
import { ShaderPolicy } from '../minecraft/ShaderChoice.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { writeInstalledPack, readInstalledPack } from './InstalledPack.ts';

test('installe les mods et les assets depuis les deux archives, puis ne retélécharge rien', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') } });
  const h = launcherHarness(server);

  await h.sync();
  assert.deepEqual(server.stats.downloads.sort(), ['assets.zip', 'mods.zip']);
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'demo-mod-1.0.0.jar')));
  assert.ok(fs.existsSync(path.join(h.game, 'resourcepacks', 'Comforts.zip')));
  assert.ok(fs.existsSync(path.join(h.game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  assert.ok(fs.existsSync(path.join(h.game, 'shaderpacks', 'KARAMON - Shader', 'shaders', 'final.fsh')));
  assert.ok(fs.existsSync(path.join(h.game, 'config', 'lumymon.json')));
  assert.match(fs.readFileSync(path.join(h.game, 'options.txt'), 'utf8'), /resourcePacks:\["vanilla","file\/Comforts.zip","file\/Karamon UI"\]/);
  assert.deepEqual(fs.readdirSync(h.game).filter((f) => f.endsWith('.tmp')), []);

  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  h.cleanup();
});

test('garde les archives installées quand pack-latest reçoit un nouvel identifiant d’asset au même digest', async () => {
  const server = new PackServer({
    base: RELEASE_BASE,
    ranges: false,
    releaseDigests: {
      'mods.zip': 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'assets.zip': 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') } });
  const h = launcherHarness(server);
  await h.sync();

  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  assert.deepEqual(server.stats.heads, []);
  h.cleanup();
});

test('garde la disposition en fichiers séparés quand le pack ne publie pas assets.zip', async () => {
  const server = new PackServer({ ranges: false });
  const rp = zipOf({ 'pack.mcmeta': 'rp-bytes' });
  server.files.set('mods.zip', zipOf({ 'demo-mod-1.0.0.jar': jarOf('demo') }));
  server.files.set('resourcepacks-manifest.json', Buffer.from(JSON.stringify([{ name: 'Comforts.zip', size: rp.length }])));
  server.files.set('shaderpacks-manifest.json', Buffer.from('[]'));
  server.files.set('resourcepacks/Comforts.zip', rp);
  server.files.set(
    'client-options.json',
    Buffer.from(JSON.stringify({ resourcePacks: ['vanilla', 'file/Comforts.zip'], shaderPack: 'none', enableShaders: false })),
  );
  const h = launcherHarness(server);

  await h.sync();
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'demo-mod-1.0.0.jar')));
  assert.deepEqual(fs.readFileSync(path.join(h.game, 'resourcepacks', 'Comforts.zip')), rp);

  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  h.cleanup();
});

test('ne réinstalle que les fichiers abîmés, et la réparation complète les liste', async () => {
  const server = new PackServer({ ranges: false });
  const demo = jarOf('demo');
  const voxy = jarOf('voxy');
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': demo, 'voxy-0.2.jar': voxy, 'oldjava-1.0.jar': jarOf('old-java') }, withManifests: true });
  const h = launcherHarness(server, { disabledJarPrefixes: ['oldjava'] });
  await h.sync();
  const mods = path.join(h.game, 'mods');
  const comforts = path.join(h.game, 'resourcepacks', 'Comforts.zip');
  const comfortsBytes = fs.readFileSync(comforts);
  assert.ok(fs.existsSync(path.join(mods, 'mods-disabled', 'oldjava-1.0.jar')));
  assert.ok(!fs.existsSync(path.join(mods, 'oldjava-1.0.jar')));

  const voxyPath = path.join(mods, 'voxy-0.2.jar');
  fs.writeFileSync(voxyPath, Buffer.concat([voxy.subarray(0, 8), Buffer.alloc(voxy.length - 8)]));
  const other = jarOf('dema');
  assert.equal(other.length, demo.length);
  fs.writeFileSync(path.join(mods, 'demo-mod-1.0.0.jar'), other);
  fs.writeFileSync(comforts, Buffer.alloc(comfortsBytes.length));
  server.resetStats();

  const report = await h.launcher.repair(h.config, () => undefined, () => undefined);
  assert.deepEqual(server.stats.downloads.sort(), ['assets.zip', 'mods.zip']);
  assert.deepEqual(report.damaged.sort(), ['mods/demo-mod-1.0.0.jar', 'mods/voxy-0.2.jar', 'resourcepacks/Comforts.zip']);
  assert.deepEqual(fs.readFileSync(voxyPath), voxy);
  assert.deepEqual(fs.readFileSync(path.join(mods, 'demo-mod-1.0.0.jar')), demo);
  assert.deepEqual(fs.readFileSync(comforts), comfortsBytes);

  server.resetStats();
  fs.writeFileSync(voxyPath, Buffer.concat([voxy.subarray(0, 8), Buffer.alloc(voxy.length - 8)]));
  await h.sync();
  assert.deepEqual(server.stats.downloads, ['mods.zip']);
  assert.deepEqual(fs.readFileSync(voxyPath), voxy);

  server.resetStats();
  const clean = await h.launcher.repair(h.config, () => undefined, () => undefined);
  assert.deepEqual(server.stats.downloads, []);
  assert.deepEqual(clean.damaged, []);
  h.cleanup();
});

test('garde l’archive des configs du pack pour pouvoir les restaurer, et la reprend si elle disparaît', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') }, withManifests: true });
  const h = launcherHarness(server);
  await h.sync();
  const archive = path.join(h.game, '.karamon-overrides.zip');
  const overrides = new AdmZipView(server.files.get('assets.zip')!).entry('overrides.zip');
  assert.deepEqual(fs.readFileSync(archive), overrides);

  fs.rmSync(archive);
  fs.writeFileSync(path.join(h.game, 'config', 'lumymon.json'), Buffer.alloc(11));
  await h.sync();
  assert.deepEqual(fs.readFileSync(archive), overrides);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.game, 'config', 'lumymon.json'), 'utf8')).ok, true);
  h.cleanup();
});

test('refuse une archive de configs qui ne correspond pas au manifeste', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') }, withManifests: true });
  const assets = new AdmZipView(server.files.get('assets.zip')!);
  const manifest = JSON.parse(assets.entry('overrides-manifest.json').toString()) as { sha1: string };
  manifest.sha1 = sha1Of(Buffer.from('autre chose'));
  server.files.set('assets.zip', assets.with('overrides-manifest.json', JSON.stringify(manifest)));
  const h = launcherHarness(server);

  await assert.rejects(h.sync(), /overrides\.zip: empreinte SHA-1 invalide/);
  assert.ok(!fs.existsSync(path.join(h.game, '.karamon-overrides.zip')));
  h.cleanup();
});

test('un état de synchronisation tronqué ne bloque pas : le pack est revérifié', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') } });
  const h = launcherHarness(server);
  await h.sync();
  const state = path.join(h.game, '.karamon-sync-cache.json');
  fs.writeFileSync(state, fs.readFileSync(state, 'utf8').slice(0, 20));

  await h.sync();
  await h.sync();
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'demo-mod-1.0.0.jar')));
  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  h.cleanup();
});

function directSync(
  server: PackServer,
  game: string,
  sync: ModpackSync,
  onStatus: (line: string) => void = () => undefined,
  playerSettings: SyncRequest['playerSettings'] = { setRevision: () => undefined, keepSettings: async () => true, settingsInstalled: () => undefined },
) {
  const request: SyncRequest = {
    baseUrl: server.base,
    instance: new GameInstance(game),
    parkedJars: new Set(),
    playerSettings,
    onStatus,
    onProgress: () => undefined,
  };
  return sync.sync(request);
}

test('après la mise à jour du launcher, le pack déjà installé garde ses options client de l’ancien format', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') } });
  const h = launcherHarness(server);
  await h.sync();
  const statePath = path.join(h.game, '.karamon-sync-cache.json');
  const { clientOptions, ...oldFormat } = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(clientOptions);
  fs.writeFileSync(statePath, JSON.stringify(oldFormat));
  const installedOptions = { ...clientOptions, shaderPack: 'KARAMON - Shader installé', shaderRevision: 7 };
  fs.writeFileSync(path.join(h.game, '.karamon-client-options.json'), JSON.stringify(installedOptions));
  const bundled = { resourcePacks: ['vanilla'], shaderPack: 'COPIE EMBARQUÉE', enableShaders: false, shaderRevision: 0 };

  server.resetStats();
  const result = await directSync(server, h.game, new ModpackSync({ http: server.http, fallbackClientOptions: bundled }));

  assert.deepEqual(server.stats.downloads, []);
  assert.equal(result.clientOptions?.shaderPack, 'KARAMON - Shader installé');
  assert.equal(result.clientOptions?.shaderRevision, 7);
  h.cleanup();
});

test('l’ancien fichier d’options client disparaît une fois l’état réécrit, sans perdre les options', () => {
  const game = makeTempDir('karamon-client-options-');
  const instance = new GameInstance(game);
  const legacy = { resourcePacks: ['vanilla', 'file/Karamon UI'], shaderPack: 'KARAMON - Shader', enableShaders: true, shaderRevision: 3 };
  fs.writeFileSync(instance.syncState, JSON.stringify({ modsEtag: 'abc', jarNames: ['a.jar'] }));
  fs.writeFileSync(instance.legacyClientOptions, JSON.stringify(legacy));

  const read = readInstalledPack(instance);
  assert.equal(read.kind, 'read');
  if (read.kind !== 'read') return;
  assert.equal(read.pack.clientOptions?.shaderRevision, 3);
  writeInstalledPack(instance, read.pack, Date.now());

  assert.equal(fs.existsSync(instance.legacyClientOptions), false);
  const reread = readInstalledPack(instance);
  assert.equal(reread.kind === 'read' && reread.pack.clientOptions?.shaderRevision, 3);
});

test('les archives temporaires d’une synchronisation interrompue sont supprimées à la suivante', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'demo-mod-1.0.0.jar': jarOf('demo') } });
  const h = launcherHarness(server);
  await h.sync();
  const instance = new GameInstance(h.game);
  const leftovers = [
    instance.tempFile('mods.zip') + '.tmp',
    instance.tempFile('assets.zip'),
    instance.tempFile('Karamon UI.zip', instance.resourcePacksDir),
    instance.tempFile('KARAMON - Shader.zip', instance.shaderPacksDir) + '.tmp',
  ];
  for (const file of leftovers) fs.writeFileSync(file, Buffer.alloc(1024));
  const kept = path.join(instance.resourcePacksDir, '.karamon-notes.txt');
  fs.writeFileSync(kept, 'à garder');

  const lines = await h.sync();

  assert.deepEqual(leftovers.filter((file) => fs.existsSync(file)), []);
  assert.ok(fs.existsSync(kept));
  assert.ok(fs.existsSync(instance.syncState));
  assert.ok(lines.some((line) => line.includes('4 fichier(s) temporaire(s)')));
  h.cleanup();
});

test('un pack republié pendant la synchronisation est revérifié en entier avec ses nouvelles clés', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'demo-1.0.jar': jarOf('demo', 64) } });
  const h = launcherHarness(server);
  await h.sync();

  publishPack(server, { jars: { 'demo-2.0.jar': jarOf('demo2', 64) } });
  const release = server.holdDownloads();
  const lines: string[] = [];
  const running = h.sync((line) => lines.push(line));
  await new Promise((resolve) => setTimeout(resolve, 50));
  publishPack(server, { jars: { 'demo-3.0.jar': jarOf('demo3', 64) } });
  release();
  await running;

  assert.deepEqual(fs.readdirSync(path.join(h.game, 'mods')).filter((f) => f.endsWith('.jar')), ['demo-3.0.jar']);
  assert.ok(lines.some((line) => line.includes('mis à jour sur le serveur pendant la synchronisation')));
  assert.ok(!lines.some((line) => line.includes('Téléchargement partiel impossible')));
  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  assert.equal(server.stats.bytes, 0);
  h.cleanup();
});

test('un pack qui change sans cesse pendant la synchronisation donne une erreur claire', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'demo-1.0.jar': jarOf('demo', 64) } });
  const h = launcherHarness(server);
  await h.sync();
  publishPack(server, { jars: { 'demo-2.0.jar': jarOf('demo2', 64) } });
  const http = server.http;
  Object.assign(http, {
    openRange: async () => {
      throw new ResourceChangedError('mods.zip');
    },
  });

  await assert.rejects(directSync(server, h.game, new ModpackSync({ http })), /Le pack change en ce moment sur le serveur/);
  h.cleanup();
});

test('une synchro qui échoue avant d’écrire les réglages du shader ne bloque pas leur mise à jour à la suivante', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'demo-1.0.jar': jarOf('demo', 64) }, shaderTxt: 'shadowDistance=4\n' });
  const h = launcherHarness(server);
  await h.sync();
  const instance = new GameInstance(h.game);
  const txt = path.join(instance.shaderPacksDir, 'KARAMON - Shader.txt');
  publishPack(server, { jars: { 'demo-1.0.jar': jarOf('demo', 64) }, shaderTxt: 'shadowDistance=8\n' });

  const cutBeforeFetch = (line: string): void => {
    if (line.includes('à mettre à jour')) throw new Error('connexion coupée');
  };
  const interrupted = new ShaderPolicy(instance);
  await assert.rejects(directSync(server, h.game, new ModpackSync({ http: server.http }), cutBeforeFetch, interrupted), /connexion coupée/);
  interrupted.save();
  assert.equal(fs.readFileSync(txt, 'utf8'), 'shadowDistance=4\n');

  const next = new ShaderPolicy(instance);
  await directSync(server, h.game, new ModpackSync({ http: server.http }), () => undefined, next);
  next.save();
  assert.equal(fs.readFileSync(txt, 'utf8'), 'shadowDistance=8\n');
  h.cleanup();
});

class AdmZipView {
  private readonly files: Record<string, Buffer> = {};

  constructor(data: Buffer) {
    const zip = new AdmZip(data);
    for (const entry of zip.getEntries()) this.files[entry.entryName] = entry.getData();
  }

  entry(name: string): Buffer {
    return this.files[name];
  }

  with(name: string, body: string): Buffer {
    return zipOf({ ...this.files, [name]: body });
  }
}

