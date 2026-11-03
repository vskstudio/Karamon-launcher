import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AssetDownloader } from './AssetDownloader.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';

test('un objet partagé par plusieurs noms n’est téléchargé qu’une fois', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  const shared = 'e9833a1512b57bcf88ac4fdcc8df4e5a7e9d701d';
  const index = { objects: { 'a.ogg': { hash: shared, size: 1 }, 'b.ogg': { hash: shared, size: 1 }, 'c.png': { hash: 'ab'.repeat(20), size: 1 } } };
  const urls: string[] = [];
  const http = {
    getText: async () => JSON.stringify(index),
    download: async (url: string) => { urls.push(url); },
  } as unknown as HttpClient;
  const labels: string[] = [];

  await new AssetDownloader(http).download({ id: '17', url: 'https://index', sha1: '', size: 0 }, dir, (_f, label) => labels.push(label));

  assert.equal(urls.filter((url) => url.endsWith(shared)).length, 1);
  assert.equal(urls.length, 2);
  assert.ok(labels.includes('Assets 2/2'));
  fs.rmSync(dir, { recursive: true, force: true });
});
