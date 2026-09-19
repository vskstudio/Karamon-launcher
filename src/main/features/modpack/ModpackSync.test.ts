import assert from 'node:assert/strict';
import { test } from 'node:test';
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

function fakeHttp(files: Record<string, string>, releaseAssets: { name: string; size: number }[]): HttpClient {
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
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': 'jar-bytes' });

  const uiZip = path.join(pack, 'Karamon UI.zip');
  zipFiles(uiZip, { 'pack.mcmeta': '{"pack":{"pack_format":34}}' });
  const rpZip = path.join(pack, 'Comforts.zip');
  fs.writeFileSync(rpZip, 'rp-bytes');
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
  assert.equal(fs.readFileSync(path.join(game, 'resourcepacks', 'Comforts.zip'), 'utf8'), 'rp-bytes');
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

test('sync keeps the loose-file layout when assets.zip is absent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sync-legacy-'));
  const pack = path.join(dir, 'pack');
  const game = path.join(dir, 'game');
  fs.mkdirSync(pack, { recursive: true });
  const modsZip = path.join(pack, 'mods.zip');
  zipFiles(modsZip, { 'demo-mod-1.0.0.jar': 'jar-bytes' });
  const rpZip = path.join(pack, 'Comforts.zip');
  fs.writeFileSync(rpZip, 'rp-bytes');

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
  assert.equal(fs.readFileSync(path.join(game, 'resourcepacks', 'Comforts.zip'), 'utf8'), 'rp-bytes');
  fs.rmSync(dir, { recursive: true, force: true });
});
