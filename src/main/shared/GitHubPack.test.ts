import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubReleaseAssetName, packAssetUrl, parseGitHubDownloadUrl } from './GitHubPack.ts';

test('githubReleaseAssetName matches GitHub release filename sanitizing', () => {
  assert.equal(githubReleaseAssetName('COBBLEVERSE RP [CF].zip'), 'COBBLEVERSE.RP.CF.zip');
  assert.equal(githubReleaseAssetName('Karamon UI.zip'), 'Karamon.UI.zip');
  assert.equal(
    githubReleaseAssetName('Cobblemon 3D Poké Rods 1.0.zip'),
    'Cobblemon.3D.Poke.Rods.1.0.zip',
  );
  assert.equal(
    githubReleaseAssetName('-1.21.2 Fresh Moves v3.1 (With Animated Eyes).zip'),
    '-1.21.2.Fresh.Moves.v3.1.With.Animated.Eyes.zip',
  );
  assert.equal(githubReleaseAssetName('bushy-leaves-1-6-5.zip'), 'bushy-leaves-1-6-5.zip');
});

test('packAssetUrl flattens and sanitizes GitHub release assets', () => {
  const base = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';
  assert.equal(
    packAssetUrl(base, 'COBBLEVERSE RP [CF].zip', 'resourcepacks/'),
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/COBBLEVERSE.RP.CF.zip',
  );
  assert.equal(
    packAssetUrl(base, 'Karamon UI.zip', 'resourcepacks/'),
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/Karamon.UI.zip',
  );
});

test('packAssetUrl keeps folder prefixes on a normal CDN', () => {
  const base = 'https://cdn.karamon.fr/downloads/';
  assert.equal(
    packAssetUrl(base, 'Karamon UI.zip', 'resourcepacks/'),
    'https://cdn.karamon.fr/downloads/resourcepacks/Karamon%20UI.zip',
  );
});

test('parseGitHubDownloadUrl reads encoded asset names', () => {
  const ref = parseGitHubDownloadUrl(
    'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/Karamon.UI.zip',
  );
  assert.deepEqual(ref, {
    owner: 'vskstudio',
    repo: 'Karamon-launcher',
    tag: 'pack-latest',
    filename: 'Karamon.UI.zip',
  });
});
