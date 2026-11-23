import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { PackServer, jarOf, launcherHarness, publishPack, zipOf } from './PackServer.fixture.ts';

function installedJars(game: string): string[] {
  return fs.readdirSync(path.join(game, 'mods')).filter((f) => f.endsWith('.jar')).sort();
}

test('ne retélécharge que le mod qui a changé, et rien quand tout est à jour', async () => {
  const server = new PackServer();
  const jars = { 'big-1.0.jar': jarOf('big', 400), 'small-1.0.jar': jarOf('small', 20), 'other-1.0.jar': jarOf('other', 200) };
  publishPack(server, { jars });
  const h = launcherHarness(server);

  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  for (const [name, body] of Object.entries(jars)) {
    assert.ok(fs.readFileSync(path.join(h.game, 'mods', name)).equals(body));
  }
  assert.ok(fs.existsSync(path.join(h.game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  assert.ok(fs.existsSync(path.join(h.game, 'shaderpacks', 'KARAMON - Shader', 'shaders', 'final.fsh')));
  assert.ok(fs.existsSync(path.join(h.game, 'config', 'lumymon.json')));

  server.resetStats();
  await h.sync();
  assert.equal(server.stats.bytes, 0);

  server.files.set('mods.zip', zipOf({ 'big-1.0.jar': jars['big-1.0.jar'], 'small-1.1.jar': jarOf('small', 20) }));
  server.resetStats();
  await h.sync();
  assert.deepEqual(server.stats.downloads, []);
  assert.ok(server.stats.bytes < 120 * 1024, `MAJ d'un petit mod: ${server.stats.bytes} octets envoyés`);
  assert.deepEqual(installedJars(h.game), ['big-1.0.jar', 'small-1.1.jar']);
  h.cleanup();
});

test('répare un mod remis à zéro sans changer de taille ni de date, en ne retéléchargeant que lui', async () => {
  const server = new PackServer();
  const jars = { 'big-1.0.jar': jarOf('big', 400), 'small-1.0.jar': jarOf('small', 20) };
  publishPack(server, { jars });
  const h = launcherHarness(server);
  await h.sync();

  const broken = path.join(h.game, 'mods', 'small-1.0.jar');
  const good = fs.readFileSync(broken);
  const st = fs.statSync(broken);
  fs.writeFileSync(broken, Buffer.alloc(st.size));
  fs.utimesSync(broken, st.atime, st.mtime);
  server.files.set('mods.zip', zipOf({ ...jars, 'tiny-1.0.jar': jarOf('tiny') }));

  server.resetStats();
  await h.sync();
  assert.ok(fs.readFileSync(broken).equals(good));
  assert.ok(server.stats.bytes < 100 * 1024, `réparation: ${server.stats.bytes} octets envoyés`);
  h.cleanup();
});

test('garde le shader et les réglages du joueur aux MAJ, sauf quand le pack relève shaderRevision', async () => {
  const server = new PackServer();
  const jars = { 'a-1.0.jar': jarOf('a', 10) };
  publishPack(server, { jars, shaderTxt: 'pack v1\n' });
  const h = launcherHarness(server);
  const iris = path.join(h.game, 'config', 'iris.properties');
  const txt = path.join(h.game, 'shaderpacks', 'KARAMON - Shader.txt');
  const choose = (): void => {
    fs.writeFileSync(iris, 'enableShaders=false\nshaderPack=MonShader.zip\n');
    fs.writeFileSync(txt, 'mes réglages\n');
  };
  const state = () => ({ iris: fs.readFileSync(iris, 'utf8'), txt: fs.readFileSync(txt, 'utf8') });

  await h.sync();
  assert.match(state().iris, /^shaderPack=KARAMON - Shader$/m);
  assert.equal(state().txt, 'pack v1\n');

  choose();
  await h.sync();
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.equal(state().txt, 'mes réglages\n');

  publishPack(server, { jars, shaderTxt: 'pack v2\n' });
  await h.sync();
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.match(state().iris, /^enableShaders=false$/m);
  assert.equal(state().txt, 'mes réglages\n');

  publishPack(server, { jars, shaderTxt: 'pack v3\n', shaderRevision: 1 });
  await h.sync();
  assert.match(state().iris, /^shaderPack=KARAMON - Shader$/m);
  assert.match(state().iris, /^enableShaders=true$/m);
  assert.equal(state().txt, 'pack v3\n');

  choose();
  await h.sync();
  publishPack(server, { jars, shaderTxt: 'pack v4\n', shaderRevision: 1 });
  await h.sync();
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.equal(state().txt, 'mes réglages\n');
  h.cleanup();
});

test('ne supprime jamais un shader ou un réglage ajouté par le joueur, mais retire ceux que le pack a abandonnés', async () => {
  const server = new PackServer();
  publishPack(server, { jars: { 'a-1.0.jar': jarOf('a', 10) } });
  const h = launcherHarness(server);
  await h.sync();
  const shaderpacks = path.join(h.game, 'shaderpacks');
  fs.writeFileSync(path.join(shaderpacks, 'MonShader.zip'), 'zip du joueur');
  fs.writeFileSync(path.join(shaderpacks, 'MonShader.zip.txt'), 'réglages du joueur');

  const assets = new AdmZip(server.files.get('assets.zip')!);
  assets.deleteFile('shaderpacks/KARAMON - Shader.txt');
  const manifest = JSON.parse(assets.getEntry('shaderpacks-manifest.json')!.getData().toString()) as { name: string }[];
  assets.updateFile('shaderpacks-manifest.json', Buffer.from(JSON.stringify(manifest.filter((m) => !m.name.endsWith('.txt')))));
  server.files.set('assets.zip', assets.toBuffer());
  await h.sync();

  assert.ok(!fs.existsSync(path.join(shaderpacks, 'KARAMON - Shader.txt')));
  assert.ok(fs.existsSync(path.join(shaderpacks, 'MonShader.zip')));
  assert.ok(fs.existsSync(path.join(shaderpacks, 'MonShader.zip.txt')));
  h.cleanup();
});

test('retombe sur le téléchargement complet si le serveur ignore Range', async () => {
  const server = new PackServer({ ranges: false });
  publishPack(server, { jars: { 'a-1.0.jar': jarOf('a', 10) } });
  const h = launcherHarness(server);
  await h.sync();
  assert.deepEqual(server.stats.downloads.sort(), ['assets.zip', 'mods.zip']);
  assert.ok(fs.existsSync(path.join(h.game, 'mods', 'a-1.0.jar')));
  assert.ok(fs.existsSync(path.join(h.game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  h.cleanup();
});

test('un mod désactivé par le mode PC modeste reste en .disabled, n’est pas retéléchargé, et une MAJ du pack le garde désactivé', async () => {
  const server = new PackServer();
  const jars = { 'big-1.0.jar': jarOf('big', 200), 'voxy-0.2.jar': jarOf('voxy', 400) };
  publishPack(server, { jars });
  const h = launcherHarness(server);
  h.config.potatoMode = true;
  await h.sync();
  const mods = path.join(h.game, 'mods');
  assert.deepEqual(fs.readdirSync(mods).filter((f) => f.includes('.jar')).sort(), ['big-1.0.jar', 'voxy-0.2.jar.disabled']);

  server.resetStats();
  await h.sync();
  assert.equal(server.stats.bytes, 0);

  server.files.set('mods.zip', zipOf({ ...jars, 'big-1.1.jar': jarOf('big', 200) }));
  server.resetStats();
  await h.sync();
  assert.ok(server.stats.bytes < 340 * 1024, `${server.stats.bytes} octets`);
  assert.deepEqual(fs.readdirSync(mods).filter((f) => f.includes('.jar')).sort(), ['big-1.0.jar', 'big-1.1.jar', 'voxy-0.2.jar.disabled']);
  assert.deepEqual(h.launcher.listMods(h.config).mods.map((m) => [m.name, m.disabled ?? false]), [
    ['big-1.0.jar', false],
    ['big-1.1.jar', false],
    ['voxy-0.2.jar', true],
  ]);

  h.config.potatoMode = false;
  await h.sync();
  assert.ok(fs.existsSync(path.join(mods, 'voxy-0.2.jar')));
  assert.ok(!fs.existsSync(path.join(mods, 'voxy-0.2.jar.disabled')));
  h.cleanup();
});

test('une réparation complète vérifie un mod désactivé sous son nom .disabled et ne le réactive pas', async () => {
  const server = new PackServer();
  const voxy = jarOf('voxy', 30);
  publishPack(server, { jars: { 'demo-1.0.jar': jarOf('demo'), 'voxy-0.2.jar': voxy }, withManifests: true });
  const h = launcherHarness(server);
  h.config.disableSodium = true;
  await h.sync();
  const parked = path.join(h.game, 'mods', 'voxy-0.2.jar.disabled');
  assert.deepEqual(fs.readFileSync(parked), voxy);

  fs.writeFileSync(parked, Buffer.alloc(voxy.length));
  const report = await h.launcher.repair(h.config, () => undefined, () => undefined);
  assert.deepEqual(report.damaged, ['mods/voxy-0.2.jar.disabled']);
  assert.deepEqual(fs.readFileSync(parked), voxy);
  assert.ok(!fs.existsSync(path.join(h.game, 'mods', 'voxy-0.2.jar')));
  h.cleanup();
});
