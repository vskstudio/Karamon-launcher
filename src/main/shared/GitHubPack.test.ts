import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubAssetFreshness, packAssetUrl } from './GitHubPack.ts';
import type { HttpClient } from './HttpClient.ts';

const RELEASE_BASE = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';

function releaseApi(assets: { name: string; size?: number; digest?: string }[]): Pick<HttpClient, 'getJson'> {
  return {
    async getJson<T>(url: string): Promise<T> {
      assert.equal(url, 'https://api.github.com/repos/vskstudio/Karamon-launcher/releases/tags/pack-latest');
      return { tag_name: 'pack-latest', assets: assets.map((a, i) => ({ id: i + 1, ...a })) } as T;
    },
  };
}

test('packAssetUrl names GitHub release assets the way GitHub sanitizes uploads', () => {
  const cases: [string, string][] = [
    ['COBBLEVERSE RP [CF].zip', 'COBBLEVERSE.RP.CF.zip'],
    ['Karamon UI.zip', 'Karamon.UI.zip'],
    ['Cobblemon 3D Poké Rods 1.0.zip', 'Cobblemon.3D.Poke.Rods.1.0.zip'],
    ['-1.21.2 Fresh Moves v3.1 (With Animated Eyes).zip', '-1.21.2.Fresh.Moves.v3.1.With.Animated.Eyes.zip'],
    ['bushy-leaves-1-6-5.zip', 'bushy-leaves-1-6-5.zip'],
  ];
  for (const [name, asset] of cases) {
    assert.equal(packAssetUrl(RELEASE_BASE, name, 'resourcepacks/'), RELEASE_BASE + asset);
  }
});

test('packAssetUrl keeps folder prefixes on a normal CDN', () => {
  assert.equal(
    packAssetUrl('https://cdn.karamon.fr/downloads/', 'Karamon UI.zip', 'resourcepacks/'),
    'https://cdn.karamon.fr/downloads/resourcepacks/Karamon%20UI.zip',
  );
});

test('a republished asset with the same digest keeps its freshness key', async () => {
  const digest = 'sha256:c8547dae34c49a797c6d980fba87fc5500c55ed4f27ff963c256371e746ba033';
  const first = await githubAssetFreshness(releaseApi([{ name: 'mods.zip', size: 383909955, digest }]), RELEASE_BASE + 'mods.zip');
  const again = await githubAssetFreshness(
    releaseApi([{ name: 'mods.zip', size: 383909956, digest: digest.toUpperCase() }]),
    RELEASE_BASE + 'mods.zip',
  );
  assert.deepEqual(first, { kind: 'found', key: digest });
  assert.deepEqual(again, first);
});

test('without a digest the asset size is its freshness key', async () => {
  assert.deepEqual(
    await githubAssetFreshness(releaseApi([{ name: 'Karamon.UI.zip', size: 100 }]), RELEASE_BASE + 'Karamon.UI.zip'),
    { kind: 'found', key: 'size:100' },
  );
});

test('an unusable or missing asset, a failing API and a non-GitHub URL are told apart', async () => {
  const failing: Pick<HttpClient, 'getJson'> = {
    async getJson<T>(): Promise<T> {
      throw new Error('HTTP 403');
    },
  };
  const unusable = await githubAssetFreshness(releaseApi([{ name: 'mods.zip', size: 0, digest: 'nope' }]), RELEASE_BASE + 'mods.zip');
  assert.equal(unusable.kind, 'unknown');
  assert.equal((await githubAssetFreshness(releaseApi([]), RELEASE_BASE + 'mods.zip')).kind, 'unknown');
  assert.match(JSON.stringify(await githubAssetFreshness(failing, RELEASE_BASE + 'mods.zip')), /HTTP 403/);
  assert.deepEqual(await githubAssetFreshness(failing, 'https://karamon.fr/downloads/mods.zip'), { kind: 'not-github' });
});
