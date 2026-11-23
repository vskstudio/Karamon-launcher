import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HttpResponse } from '../../shared/HttpClient.ts';
import { PackManifest } from './PackManifest.ts';

const MANIFEST_URL = 'https://karamon.fr/downloads/pack.json';
const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  id: 'karamon-client',
  version,
  minecraft: '1.21.1',
  loader: 'fabric',
  loaderVersion: '0.18.4',
  baseModpack: { platform: 'curseforge', name: 'COBBLEVERSE 1.7.42' },
  notes: `Pack ${version} : nouveautés.`,
  ...extra,
});

interface Remote {
  serve: (() => HttpResponse) | null;
  requests: number;
}

function withState(run: (packOn: (remote: Remote, now?: () => number) => PackManifest) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-pack-'));
  const packOn = (remote: Remote, now?: () => number) =>
    new PackManifest({
      http: {
        get: async (url: string) => {
          assert.equal(url, MANIFEST_URL);
          remote.requests++;
          if (!remote.serve) throw new Error('getaddrinfo ENOTFOUND karamon.fr');
          return remote.serve();
        },
      },
      manifestUrl: MANIFEST_URL,
      stateFile: path.join(dir, 'pack-versions.json'),
      bundled: { minecraft: '1.21.1', fabricVersion: '0.18.3' },
      now,
    });
  return run(packOn).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

const serving = (body: unknown) => (): HttpResponse => ({ status: 200, body: Buffer.from(JSON.stringify(body)) });

test('the installed pack is up to date only while it matches the published version', () =>
  withState(async (packOn) => {
    const remote: Remote = { serve: serving(manifest('0.9.18')), requests: 0 };
    let clock = 1_000;
    const pack = packOn(remote, () => clock);
    pack.markInstalled('/games/karamon', '0.9.18');
    assert.deepEqual(await pack.info('/games/karamon'), {
      version: '0.9.18',
      minecraft: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.18.4',
      baseName: 'COBBLEVERSE 1.7.42',
      upToDate: true,
    });
    remote.serve = serving(manifest('0.9.19'));
    clock += 10 * 60 * 1000;
    assert.equal((await pack.info('/games/karamon')).upToDate, false);
    assert.equal((await pack.info('/games/other')).upToDate, null);
  }));

test('offline, the installed version stays known but freshness is unknown', () =>
  withState(async (packOn) => {
    await packOn({ serve: serving(manifest('0.9.18')), requests: 0 }).latest();
    const earlier = packOn({ serve: serving(manifest('0.9.18')), requests: 0 });
    earlier.markInstalled('/games/karamon', '0.9.18');

    const offline = packOn({ serve: null, requests: 0 });
    assert.deepEqual(await offline.info('/games/karamon'), {
      version: '0.9.18',
      minecraft: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.18.4',
      baseName: 'COBBLEVERSE 1.7.42',
      upToDate: null,
    });
    assert.deepEqual(await packOn({ serve: null, requests: 0 }).info('/never/synced'), {
      version: null,
      minecraft: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.18.4',
      baseName: 'COBBLEVERSE 1.7.42',
      upToDate: null,
    });
  }));

test('each published version keeps the date the launcher first saw it, or the date the manifest gives', () =>
  withState(async (packOn) => {
    let clock = 5_000;
    await packOn({ serve: serving(manifest('0.9.18')), requests: 0 }, () => clock).latest();
    clock = 9_000;
    await packOn({ serve: serving(manifest('0.9.18')), requests: 0 }, () => clock).latest();
    await packOn({ serve: serving(manifest('0.9.19', { publishedAt: '2026-11-20T10:00:00Z' })), requests: 0 }, () => clock).latest();
    assert.deepEqual(
      packOn({ serve: null, requests: 0 }).seenVersions().map(({ version, publishedAt }) => ({ version, publishedAt })),
      [
        { version: '0.9.19', publishedAt: Date.parse('2026-11-20T10:00:00Z') },
        { version: '0.9.18', publishedAt: 5_000 },
      ],
    );
  }));

test('concurrent readers share one download of the manifest', () =>
  withState(async (packOn) => {
    const remote: Remote = { serve: serving(manifest('0.9.18')), requests: 0 };
    const pack = packOn(remote);
    await Promise.all([pack.latest(), pack.latest(), pack.info('/games/karamon')]);
    await pack.latest();
    assert.equal(remote.requests, 1);
  }));
