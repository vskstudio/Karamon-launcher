import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import { ModpackSync } from './ModpackSync.ts';
import { RangeUnsupportedError, type HttpClient, type RangeRequest } from '../../shared/HttpClient.ts';
import { OptionsWriter } from '../minecraft/OptionsWriter.ts';

/** A karamon.fr-like server: ETag per file, HEAD, Range, full downloads; counts bytes sent. */
function server(files: Map<string, Buffer>, { ranges = true } = {}) {
  const sent = { bytes: 0, full: 0 };
  const etagOf = (name: string): string => `"${crypto.createHash('sha1').update(files.get(name)!).digest('hex').slice(0, 12)}"`;
  const nameOf = (url: string): string => decodeURIComponent(url.split('/').pop() ?? '');
  const slice = (url: string, r: RangeRequest) => {
    const name = nameOf(url);
    const body = files.get(name);
    if (!body) throw new Error(`HTTP 404 ${name}`);
    if (!ranges) throw new RangeUnsupportedError('HTTP 200');
    if (r.ifRange && r.ifRange !== etagOf(name)) throw new RangeUnsupportedError('HTTP 200 (changé)');
    const start = r.end === undefined && r.start < 0 ? Math.max(0, body.length + r.start) : r.start;
    const end = r.end === undefined ? body.length - 1 : r.end;
    sent.bytes += end - start + 1;
    return { data: body.subarray(start, end + 1), start, end, total: body.length, etag: etagOf(name) };
  };
  const http = {
    async getText(url: string): Promise<string> {
      throw new Error(`HTTP 404 for ${url}`);
    },
    async getJson(url: string): Promise<unknown> {
      throw new Error(`HTTP 404 for ${url}`);
    },
    async head(url: string) {
      return { etag: etagOf(nameOf(url)), 'content-length': String(files.get(nameOf(url))!.length) };
    },
    async getRange(url: string, r: RangeRequest) {
      const s = slice(url, r);
      return { body: Buffer.from(s.data), start: s.start, total: s.total, etag: s.etag };
    },
    async openRange(url: string, r: RangeRequest) {
      const s = slice(url, r);
      const stream = new PassThrough();
      stream.end(Buffer.from(s.data));
      return { stream, start: s.start, end: s.end, total: s.total, etag: s.etag };
    },
    async download(url: string, dest: string): Promise<void> {
      const body = files.get(nameOf(url));
      if (!body) throw new Error(`HTTP 404 downloading ${url}`);
      sent.bytes += body.length;
      sent.full++;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    },
  } as unknown as HttpClient;
  return { http, sent };
}

function zip(files: Record<string, Buffer | string>): Buffer {
  const z = new AdmZip();
  for (const [name, body] of Object.entries(files)) z.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body));
  return z.toBuffer();
}

function jar(id: string, kb: number): Buffer {
  return zip({ 'fabric.mod.json': JSON.stringify({ id }), 'blob.bin': crypto.randomBytes(kb * 1024) });
}

function pack(jars: Record<string, Buffer>, shaderTxt = 'shadowDistance=4\n', shaderRevision?: number) {
  const ui = zip({ 'pack.mcmeta': '{"pack":{"pack_format":34}}' });
  const rp = zip({ 'pack.mcmeta': 'rp' });
  const overrides = zip({ 'config/lumymon.json': '{"ok":true}' });
  const shader = zip({ 'shaders/final.fsh': 'void main(){}', 'shaders.properties': 'x=1' });
  const assets = zip({
    'client-options.json': JSON.stringify({
      resourcePacks: ['vanilla', 'file/Karamon UI'],
      shaderPack: 'KARAMON - Shader',
      enableShaders: true,
      ...(shaderRevision === undefined ? {} : { shaderRevision }),
    }),
    'resourcepacks-manifest.json': JSON.stringify([
      { name: 'Comforts.zip', size: rp.length },
      { name: 'Karamon UI.zip', size: ui.length, extract: true },
    ]),
    'shaderpacks-manifest.json': JSON.stringify([
      { name: 'KARAMON - Shader.zip', size: shader.length, extract: true },
      { name: 'KARAMON - Shader.txt', size: Buffer.byteLength(shaderTxt) },
    ]),
    'overrides-manifest.json': JSON.stringify({ name: 'overrides.zip', size: overrides.length }),
    'overrides.zip': overrides,
    'resourcepacks/Comforts.zip': rp,
    'resourcepacks/Karamon UI.zip': ui,
    'shaderpacks/KARAMON - Shader.zip': shader,
    'shaderpacks/KARAMON - Shader.txt': shaderTxt,
  });
  return new Map([
    ['mods.zip', zip(jars)],
    ['assets.zip', assets],
  ]);
}

async function run(sync: ModpackSync, game: string): Promise<string[]> {
  const lines: string[] = [];
  await sync.sync('https://karamon.fr/downloads/', game, (m) => lines.push(m), () => undefined);
  return lines;
}

test('ne retélécharge que le mod qui a changé, et rien quand tout est à jour', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const jars = { 'big-1.0.jar': jar('big', 400), 'small-1.0.jar': jar('small', 20), 'other-1.0.jar': jar('other', 200) };
  const files = pack(jars);
  const { http, sent } = server(files);
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d) });

  const first = await run(sync, game);
  assert.equal(sent.full, 0, 'aucun téléchargement complet');
  assert.ok(first.some((l) => /fichier\(s\) à mettre à jour/.test(l)));
  for (const [name, body] of Object.entries(jars)) {
    const installed = fs.readFileSync(path.join(game, 'mods', name));
    assert.ok(installed.equals(new AdmZip(files.get('mods.zip')!).getEntry(name)!.getData()) && installed.length === body.length);
  }
  assert.ok(fs.existsSync(path.join(game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  assert.ok(fs.existsSync(path.join(game, 'shaderpacks', 'KARAMON - Shader', 'shaders', 'final.fsh')));
  assert.ok(fs.existsSync(path.join(game, 'config', 'lumymon.json')));

  sent.bytes = 0;
  assert.equal((await run(sync, game)).at(-1), 'Pack déjà à jour, aucun téléchargement nécessaire.');
  assert.equal(sent.bytes, 0);

  // Pack update: one small jar changes, one jar is removed.
  const next = { 'big-1.0.jar': jars['big-1.0.jar'], 'small-1.1.jar': jar('small', 20) };
  const updated = pack(next);
  files.set('mods.zip', updated.get('mods.zip')!);
  sent.bytes = 0;
  const third = await run(sync, game);
  assert.equal(sent.full, 0);
  assert.ok(sent.bytes < 120 * 1024, `MAJ d'un petit mod: ${sent.bytes} octets envoyés`);
  assert.ok(third.includes('Mod supprimé: small-1.0.jar'));
  assert.ok(third.includes('Mod supprimé: other-1.0.jar'));
  assert.deepEqual(fs.readdirSync(path.join(game, 'mods')).filter((f) => f.endsWith('.jar')).sort(), ['big-1.0.jar', 'small-1.1.jar']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('répare un mod abîmé en ne retéléchargeant que lui', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const files = pack({ 'big-1.0.jar': jar('big', 400), 'small-1.0.jar': jar('small', 20) });
  const { http, sent } = server(files);
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d) });
  await run(sync, game);

  const broken = path.join(game, 'mods', 'small-1.0.jar');
  const good = fs.readFileSync(broken);
  const st = fs.statSync(broken);
  fs.writeFileSync(broken, Buffer.alloc(st.size));
  fs.utimesSync(broken, st.atime, st.mtime);
  // The pack moved on (new ETag) while nothing in it changed for this jar.
  files.set('assets.zip', Buffer.concat([files.get('assets.zip')!]));
  const cacheFile = path.join(game, '.karamon-sync-cache.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  cache.modsEtag = 'ancien';
  fs.writeFileSync(cacheFile, JSON.stringify(cache));

  sent.bytes = 0;
  await run(sync, game);
  assert.ok(fs.readFileSync(broken).equals(good));
  assert.ok(sent.bytes < 100 * 1024, `réparation: ${sent.bytes} octets envoyés`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('garde le shader et les réglages du joueur aux MAJ, sauf quand le pack relève shaderRevision', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const jars = { 'a-1.0.jar': jar('a', 10) };
  const files = pack(jars, 'pack v1\n');
  const { http } = server(files);
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d) });
  const iris = path.join(game, 'config', 'iris.properties');
  const txt = path.join(game, 'shaderpacks', 'KARAMON - Shader.txt');
  const choose = (): void => {
    fs.writeFileSync(iris, 'enableShaders=false\nshaderPack=MonShader.zip\n');
    fs.writeFileSync(txt, 'mes réglages\n');
  };
  const state = () => ({ iris: fs.readFileSync(iris, 'utf8'), txt: fs.readFileSync(txt, 'utf8') });

  await run(sync, game);
  assert.match(state().iris, /^shaderPack=KARAMON - Shader$/m);
  assert.equal(state().txt, 'pack v1\n');

  choose();
  await run(sync, game);
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.equal(state().txt, 'mes réglages\n');

  // Pack update with new shader settings, no revision: the player's choices stay.
  for (const [k, v] of pack(jars, 'pack v2\n')) files.set(k, v);
  await run(sync, game);
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.match(state().iris, /^enableShaders=false$/m);
  assert.equal(state().txt, 'mes réglages\n');

  // The pack raises shaderRevision: its shader and settings are applied once.
  for (const [k, v] of pack(jars, 'pack v3\n', 1)) files.set(k, v);
  const lines = await run(sync, game);
  assert.match(state().iris, /^shaderPack=KARAMON - Shader$/m);
  assert.match(state().iris, /^enableShaders=true$/m);
  assert.equal(state().txt, 'pack v3\n');
  assert.ok(lines.includes('Shader du pack appliqué : KARAMON - Shader.'));

  // Then the player is free again.
  choose();
  await run(sync, game);
  for (const [k, v] of pack(jars, 'pack v4\n', 1)) files.set(k, v);
  await run(sync, game);
  assert.match(state().iris, /^shaderPack=MonShader\.zip$/m);
  assert.equal(state().txt, 'mes réglages\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ne supprime jamais un shader ou un réglage ajouté par le joueur, mais retire ceux que le pack a abandonnés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const files = pack({ 'a-1.0.jar': jar('a', 10) });
  const { http } = server(files);
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d) });
  await run(sync, game);
  fs.writeFileSync(path.join(game, 'shaderpacks', 'MonShader.zip'), 'zip du joueur');
  fs.writeFileSync(path.join(game, 'shaderpacks', 'MonShader.zip.txt'), 'réglages du joueur');

  // The pack drops its .txt: it was ours, it goes; the player's files stay.
  const assets = new AdmZip(files.get('assets.zip')!);
  assets.deleteFile('shaderpacks/KARAMON - Shader.txt');
  const manifest = JSON.parse(assets.getEntry('shaderpacks-manifest.json')!.getData().toString()) as { name: string }[];
  assets.updateFile('shaderpacks-manifest.json', Buffer.from(JSON.stringify(manifest.filter((m) => !m.name.endsWith('.txt')))));
  files.set('assets.zip', assets.toBuffer());
  const lines = await run(sync, game);

  assert.ok(lines.includes('Shader pack supprimé: KARAMON - Shader.txt'));
  assert.ok(fs.existsSync(path.join(game, 'shaderpacks', 'MonShader.zip')));
  assert.ok(fs.existsSync(path.join(game, 'shaderpacks', 'MonShader.zip.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('retombe sur le téléchargement complet si le serveur ignore Range', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const files = pack({ 'a-1.0.jar': jar('a', 10) });
  const { http, sent } = server(files, { ranges: false });
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d) });
  await run(sync, game);
  assert.equal(sent.full, 2);
  assert.ok(fs.existsSync(path.join(game, 'mods', 'a-1.0.jar')));
  assert.ok(fs.existsSync(path.join(game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mode PC modeste : un mod parqué reste en .disabled, rien n’est retéléchargé, une MAJ du pack le garde parqué', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-delta-'));
  const game = path.join(dir, 'game');
  const jars = { 'big-1.0.jar': jar('big', 200), 'voxy-0.2.jar': jar('voxy', 400) };
  const files = pack(jars);
  const { http, sent } = server(files);
  let parked: string[] = [];
  const sync = new ModpackSync({ http, optionsWriterFactory: (d) => new OptionsWriter(d), parkedJars: () => parked });
  await run(sync, game);
  const mods = path.join(game, 'mods');

  // The mode parks voxy after the sync, as PotatoMode does.
  fs.renameSync(path.join(mods, 'voxy-0.2.jar'), path.join(mods, 'voxy-0.2.jar.disabled'));
  parked = ['voxy-0.2.jar'];
  sent.bytes = 0;
  assert.equal((await run(sync, game)).at(-1), 'Pack déjà à jour, aucun téléchargement nécessaire.');
  assert.equal(sent.bytes, 0);

  // Pack update touching another jar: voxy stays parked and is not downloaded again.
  files.set('mods.zip', pack({ ...jars, 'big-1.1.jar': jar('big', 200) }).get('mods.zip')!);
  sent.bytes = 0;
  const lines = await run(sync, game);
  // 200 Ko for big-1.1, plus zip directories; voxy (400 Ko) is not fetched.
  assert.ok(sent.bytes < 340 * 1024, `${sent.bytes} octets`);
  assert.ok(!lines.some((l) => l.includes('voxy')), lines.join(' | '));
  assert.deepEqual(fs.readdirSync(mods).sort(), ['big-1.0.jar', 'big-1.1.jar', 'voxy-0.2.jar.disabled']);
  fs.rmSync(dir, { recursive: true, force: true });
});
