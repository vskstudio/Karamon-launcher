import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { PackServer, RELEASE_BASE, jarOf, launcherHarness, publishPack, sha1Of, zipOf } from './PackServer.fixture.ts';

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

