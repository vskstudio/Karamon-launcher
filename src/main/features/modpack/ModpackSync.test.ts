import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { ModpackSync } from './ModpackSync.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { OptionsWriter } from '../minecraft/OptionsWriter.ts';

function zipFiles(filePath: string, files: Record<string, string | Buffer>): void {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'));
  }
  zip.writeZip(filePath);
}

function jarBytes(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id })));
  return zip.toBuffer();
}

function sha1(data: Buffer): string {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function fakeHttp(
  files: Record<string, string>,
  releaseAssets: { name: string; size: number; digest?: string }[],
): HttpClient {
  return {
    async getText(url: string): Promise<string> {
      throw new Error(`HTTP 404 for ${url}`);
    },
    async getJson(url: string): Promise<unknown> {
      if (url.includes('/releases/')) {
        return {
          tag_name: 'pack-latest',
          assets: releaseAssets.map((asset, id) => ({
            id: id + 1,
            name: asset.name,
            size: asset.size,
            digest: asset.digest,
            updated_at: '2026-09-20T00:00:00Z',
          })),
        };
      }
      throw new Error(`HTTP 404 for ${url}`);
    },
    async head(): Promise<Record<string, string>> {
      return {};
    },
    async download(url: string, dest: string): Promise<void> {
      const name = decodeURIComponent(url.split('/').pop() ?? '');
      const src = files[name];
      if (!src) throw new Error(`HTTP 404 downloading ${name}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    },
  } as unknown as HttpClient;
}

test('sync installs mods and assets from two zips', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });

  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': jarBytes('demo') });

  const uiZip = path.join(pack, 'Karamon UI.zip');
  zipFiles(uiZip, { 'pack.mcmeta': '{"pack":{"pack_format":34}}' });
  const rpZip = path.join(pack, 'Comforts.zip');
  zipFiles(rpZip, { 'pack.mcmeta': 'rp-bytes' });
  const overridesZip = path.join(pack, 'overrides.zip');
  zipFiles(overridesZip, { 'config/lumymon.json': '{"ok":true}' });

  const assetsZip = path.join(pack, 'assets.zip');
  zipFiles(assetsZip, {
    'client-options.json': JSON.stringify({
      resourcePacks: ['vanilla', 'file/Comforts.zip', 'file/Karamon UI'],
      shaderPack: 'COBBLEVERSE - Shaders',
      enableShaders: true,
    }),
    'resourcepacks-manifest.json': JSON.stringify([
      { name: 'Comforts.zip', size: fs.statSync(rpZip).size },
      { name: 'Karamon UI.zip', size: fs.statSync(uiZip).size, extract: true },
    ]),
    'shaderpacks-manifest.json': JSON.stringify([]),
    'overrides-manifest.json': JSON.stringify({
      name: 'overrides.zip',
      size: fs.statSync(overridesZip).size,
    }),
    'overrides.zip': fs.readFileSync(overridesZip),
    'resourcepacks/Comforts.zip': fs.readFileSync(rpZip),
    'resourcepacks/Karamon UI.zip': fs.readFileSync(uiZip),
  });

  const sync = new ModpackSync({
    http: fakeHttp(
      { 'mods.zip': modsZip, 'assets.zip': assetsZip },
      [
        { name: 'mods.zip', size: fs.statSync(modsZip).size },
        { name: 'assets.zip', size: fs.statSync(assetsZip).size },
      ],
    ),
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
  });

  const statuses: string[] = [];
  await sync.sync(
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/',
    game,
    (msg) => statuses.push(msg),
    () => undefined,
  );

  assert.ok(fs.existsSync(path.join(game, 'mods', 'demo-mod-1.0.0.jar')));
  assert.deepEqual(fs.readFileSync(path.join(game, 'resourcepacks', 'Comforts.zip')), fs.readFileSync(rpZip));
  assert.ok(fs.existsSync(path.join(game, 'resourcepacks', 'Karamon UI', 'pack.mcmeta')));
  assert.ok(fs.existsSync(path.join(game, 'config', 'lumymon.json')));
  assert.match(statuses.at(-1) ?? '', /1 mods, 2 resource packs/);

  const again: string[] = [];
  await sync.sync(
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/',
    game,
    (msg) => again.push(msg),
    () => undefined,
  );
  assert.equal(again.at(-1), 'Pack déjà à jour, aucun téléchargement nécessaire.');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync keeps installed zips when pack-latest gets a new asset id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-digest-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });
  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': jarBytes('demo') });
  const assetsZip = path.join(pack, 'assets.zip');
  zipFiles(assetsZip, {
    'client-options.json': JSON.stringify({
      resourcePacks: ['vanilla'],
      shaderPack: 'none',
      enableShaders: false,
    }),
    'resourcepacks-manifest.json': '[]',
    'shaderpacks-manifest.json': '[]',
  });
  const digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const assetsDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const base = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';
  const files = { 'mods.zip': modsZip, 'assets.zip': assetsZip };
  const first = new ModpackSync({
    http: fakeHttp(files, [
      { name: 'mods.zip', size: fs.statSync(modsZip).size, digest },
      { name: 'assets.zip', size: fs.statSync(assetsZip).size, digest: assetsDigest },
    ]),
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
  });
  await first.sync(base, game, () => undefined, () => undefined);

  let downloads = 0;
  const second = new ModpackSync({
    http: {
      async getText(): Promise<string> {
        throw new Error('unexpected');
      },
      async getJson(): Promise<unknown> {
        return {
          assets: [
            { id: 9001, name: 'mods.zip', size: 1, digest, updated_at: '2026-09-23T00:00:00Z' },
            { id: 9002, name: 'assets.zip', size: 1, digest: assetsDigest, updated_at: '2026-09-23T00:00:00Z' },
          ],
        };
      },
      async head(): Promise<Record<string, string>> {
        return {};
      },
      async download(): Promise<void> {
        downloads++;
        throw new Error('should not download');
      },
    } as unknown as HttpClient,
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
  });
  const statuses: string[] = [];
  await second.sync(base, game, (msg) => statuses.push(msg), () => undefined);
  assert.equal(downloads, 0);
  assert.equal(statuses.at(-1), 'Pack déjà à jour, aucun téléchargement nécessaire.');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync keeps the loose-file layout when assets.zip is absent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-legacy-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });
  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': jarBytes('demo') });
  const rpZip = path.join(pack, 'Comforts.zip');
  zipFiles(rpZip, { 'pack.mcmeta': 'rp-bytes' });

  const files: Record<string, string> = { 'mods.zip': modsZip, 'Comforts.zip': rpZip };
  const sync = new ModpackSync({
    http: {
      async getText(url: string): Promise<string> {
        if (url.endsWith('resourcepacks-manifest.json')) {
          return JSON.stringify([{ name: 'Comforts.zip', size: fs.statSync(rpZip).size }]);
        }
        if (url.endsWith('shaderpacks-manifest.json')) return '[]';
        if (url.endsWith('overrides-manifest.json')) throw new Error('HTTP 404');
        if (url.endsWith('client-options.json')) {
          return JSON.stringify({
            resourcePacks: ['vanilla', 'file/Comforts.zip'],
            shaderPack: 'none',
            enableShaders: false,
          });
        }
        throw new Error(`HTTP 404 for ${url}`);
      },
      async getJson(url: string): Promise<unknown> {
        if (url.includes('/releases/')) {
          return {
            assets: [{ id: 1, name: 'mods.zip', size: fs.statSync(modsZip).size, updated_at: '2026-09-20T00:00:00Z' }],
          };
        }
        throw new Error(`HTTP 404 for ${url}`);
      },
      async head(): Promise<Record<string, string>> {
        return {};
      },
      async download(url: string, dest: string): Promise<void> {
        const name = decodeURIComponent(url.split('/').pop() ?? '');
        const src = files[name];
        if (!src) throw new Error(`HTTP 404 downloading ${name}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      },
    } as unknown as HttpClient,
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
  });

  await sync.sync(
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/',
    game,
    () => undefined,
    () => undefined,
  );
  assert.ok(fs.existsSync(path.join(game, 'mods', 'demo-mod-1.0.0.jar')));
  assert.deepEqual(fs.readFileSync(path.join(game, 'resourcepacks', 'Comforts.zip')), fs.readFileSync(rpZip));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync reinstalls only the damaged files listed with a sha1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-repair-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });
  const demo = jarBytes('demo');
  const voxy = jarBytes('voxy');
  const legacy = jarBytes('old-java');
  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': demo, 'voxy-0.2.jar': voxy, 'oldjava-1.0.jar': legacy });
  const rpZip = path.join(pack, 'Comforts.zip');
  zipFiles(rpZip, { 'pack.mcmeta': '{"pack":{"pack_format":34}}' });
  const rpBytes = fs.readFileSync(rpZip);
  const assetsZip = path.join(pack, 'assets.zip');
  zipFiles(assetsZip, {
    'client-options.json': JSON.stringify({ resourcePacks: ['vanilla'], shaderPack: 'none', enableShaders: false }),
    'mods-manifest.json': JSON.stringify([
      { name: 'demo-mod-1.0.0.jar', size: demo.length, sha1: sha1(demo) },
      { name: 'oldjava-1.0.jar', size: legacy.length, sha1: sha1(legacy) },
      { name: 'voxy-0.2.jar', size: voxy.length, sha1: sha1(voxy) },
    ]),
    'resourcepacks-manifest.json': JSON.stringify([
      { name: 'Comforts.zip', size: rpBytes.length, sha1: sha1(rpBytes) },
    ]),
    'shaderpacks-manifest.json': '[]',
    'resourcepacks/Comforts.zip': rpBytes,
  });
  const base = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';
  const downloads: string[] = [];
  const http = fakeHttp({ 'mods.zip': modsZip, 'assets.zip': assetsZip }, [
    { name: 'mods.zip', size: fs.statSync(modsZip).size },
    { name: 'assets.zip', size: fs.statSync(assetsZip).size },
  ]);
  const download = http.download.bind(http);
  http.download = (async (url: string, dest: string) => {
    downloads.push(decodeURIComponent(url.split('/').pop() ?? ''));
    await download(url, dest);
  }) as HttpClient['download'];
  const sync = new ModpackSync({
    http,
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
    disabledJarPrefixes: ['oldjava'],
  });
  await sync.sync(base, game, () => undefined, () => undefined);
  assert.equal(fs.existsSync(path.join(game, 'mods', 'mods-disabled', 'oldjava-1.0.jar')), true);

  // Crash: voxy keeps its size but its tail is zeroed; demo is swapped for a same-size valid jar.
  const voxyPath = path.join(game, 'mods', 'voxy-0.2.jar');
  fs.writeFileSync(voxyPath, Buffer.concat([voxy.subarray(0, 8), Buffer.alloc(voxy.length - 8)]));
  const other = jarBytes('dema');
  assert.equal(other.length, demo.length);
  fs.writeFileSync(path.join(game, 'mods', 'demo-mod-1.0.0.jar'), other);
  fs.writeFileSync(path.join(game, 'resourcepacks', 'Comforts.zip'), Buffer.alloc(rpBytes.length));
  downloads.length = 0;

  const report = await sync.sync(base, game, () => undefined, () => undefined);
  assert.deepEqual(downloads.sort(), ['assets.zip', 'mods.zip']);
  assert.deepEqual(report.damaged.sort(), [
    'mods/demo-mod-1.0.0.jar',
    'mods/voxy-0.2.jar',
    'resourcepacks/Comforts.zip',
  ]);
  assert.deepEqual(fs.readFileSync(voxyPath), voxy);
  assert.deepEqual(fs.readFileSync(path.join(game, 'mods', 'demo-mod-1.0.0.jar')), demo);
  assert.deepEqual(fs.readFileSync(path.join(game, 'resourcepacks', 'Comforts.zip')), rpBytes);
  assert.equal(fs.existsSync(path.join(game, 'mods', 'oldjava-1.0.jar')), false);

  downloads.length = 0;
  fs.writeFileSync(voxyPath, Buffer.concat([voxy.subarray(0, 8), Buffer.alloc(voxy.length - 8)]));
  const onlyMods = await sync.sync(base, game, () => undefined, () => undefined);
  assert.deepEqual(downloads, ['mods.zip']);
  assert.deepEqual(onlyMods.damaged, ['mods/voxy-0.2.jar']);

  downloads.length = 0;
  const clean = await sync.sync(base, game, () => undefined, () => undefined, { verifyAll: true });
  assert.deepEqual(downloads, []);
  assert.deepEqual(clean.damaged, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync keeps the overrides archive so configs can be restored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-overrides-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });
  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': jarBytes('demo') });
  const overridesZip = path.join(pack, 'overrides.zip');
  zipFiles(overridesZip, { 'config/lumymon.json': '{"ok":true}' });
  const overridesBytes = fs.readFileSync(overridesZip);
  const assetsZip = path.join(pack, 'assets.zip');
  zipFiles(assetsZip, {
    'client-options.json': JSON.stringify({ resourcePacks: ['vanilla'], shaderPack: 'none', enableShaders: false }),
    'resourcepacks-manifest.json': '[]',
    'shaderpacks-manifest.json': '[]',
    'overrides-manifest.json': JSON.stringify({
      name: 'overrides.zip',
      size: overridesBytes.length,
      sha1: sha1(overridesBytes),
    }),
    'overrides.zip': overridesBytes,
  });
  const sync = new ModpackSync({
    http: fakeHttp({ 'mods.zip': modsZip, 'assets.zip': assetsZip }, [
      { name: 'mods.zip', size: fs.statSync(modsZip).size },
      { name: 'assets.zip', size: fs.statSync(assetsZip).size },
    ]),
    optionsWriterFactory: (gameDir) => new OptionsWriter(gameDir),
  });
  const base = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';
  await sync.sync(base, game, () => undefined, () => undefined);
  const archive = ModpackSync.overridesArchive(game);
  assert.ok(archive);
  assert.deepEqual(fs.readFileSync(archive), overridesBytes);

  fs.rmSync(archive);
  const statuses: string[] = [];
  await sync.sync(base, game, (msg) => statuses.push(msg), () => undefined);
  assert.notEqual(statuses.at(-1), 'Pack déjà à jour, aucun téléchargement nécessaire.');
  assert.ok(ModpackSync.overridesArchive(game));
  fs.rmSync(dir, { recursive: true, force: true });
});
