import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { FabricInstaller } from './FabricInstaller.ts';
import { VersionManifest } from './VersionManifest.ts';
import { AssetDownloader } from './AssetDownloader.ts';

const sha1 = (text: string): string => crypto.createHash('sha1').update(text).digest('hex');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-metadata-'));
}

function textServer(files: Record<string, string>) {
  const fetched: string[] = [];
  const http = {
    async getText(url: string): Promise<string> {
      fetched.push(url);
      if (!(url in files)) throw new Error(`HTTP 404 for ${url}`);
      return files[url];
    },
    async getJson<T>(url: string): Promise<T> {
      return JSON.parse(await this.getText(url)) as T;
    },
    async download(): Promise<void> {},
  };
  return { http: http as unknown as HttpClient, fetched };
}

test('un profil Fabric tronqué par une coupure est retéléchargé au lancement suivant', async () => {
  const dir = tempDir();
  const id = 'fabric-loader-0.18.4-1.21.1';
  const profile = JSON.stringify({ id, inheritsFrom: '1.21.1', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient' });
  const url = 'https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.18.4/profile/json';
  const { http, fetched } = textServer({ [url]: profile });
  const fabric = new FabricInstaller({ mcVersion: '1.21.1', fabricVersion: '0.18.4', http });
  const file = path.join(dir, id, `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, profile.slice(0, 30));

  assert.equal(await fabric.profileJson(dir), profile);
  assert.equal(fs.readFileSync(file, 'utf8'), profile);
  assert.equal(await fabric.profileJson(dir), profile);
  assert.deepEqual(fetched, [url]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un JSON de version vanilla illisible est retéléchargé et vérifié avec l’empreinte du manifeste', async () => {
  const dir = tempDir();
  const version = JSON.stringify({ id: '1.21.1', mainClass: 'net.minecraft.client.main.Main' });
  const manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
  const versionUrl = 'https://piston-meta.mojang.com/v1/packages/x/1.21.1.json';
  const manifest = (hash: string) => JSON.stringify({ versions: [{ id: '1.21.1', type: 'release', url: versionUrl, sha1: hash }] });
  const dest = path.join(dir, '1.21.1', '1.21.1.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.alloc(version.length));

  const good = textServer({ [manifestUrl]: manifest(sha1(version)), [versionUrl]: version });
  assert.equal(await new VersionManifest(good.http).fetchVersionJson('1.21.1', dest), version);
  assert.equal(fs.readFileSync(dest, 'utf8'), version);

  fs.writeFileSync(dest, '{"id":"1.21');
  const wrongHash = textServer({ [manifestUrl]: manifest(sha1('autre')), [versionUrl]: version });
  await assert.rejects(new VersionManifest(wrongHash.http).fetchVersionJson('1.21.1', dest), /empreinte SHA-1/);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"id":"1.21');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un index des assets qui ne correspond plus à son empreinte est retéléchargé', async () => {
  const dir = tempDir();
  const index = JSON.stringify({ objects: {} });
  const url = 'https://piston-meta.mojang.com/v1/packages/y/17.json';
  const indexFile = path.join(dir, 'indexes', '17.json');
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify({ objects: { broken: true } }));
  const { http, fetched } = textServer({ [url]: index });

  await new AssetDownloader(http).download({ id: '17', url, sha1: sha1(index), size: index.length }, dir);
  assert.equal(fs.readFileSync(indexFile, 'utf8'), index);
  await new AssetDownloader(http).download({ id: '17', url, sha1: sha1(index), size: index.length }, dir);
  assert.deepEqual(fetched, [url]);
  fs.rmSync(dir, { recursive: true, force: true });
});
