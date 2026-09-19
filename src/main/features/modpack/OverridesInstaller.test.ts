import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { installOverrides, isForcedOverride, normalizeOverridePath } from './OverridesInstaller.ts';

function makeZip(dir: string, files: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(body, 'utf8'));
  }
  const zipPath = path.join(dir, 'overrides.zip');
  zip.writeZip(zipPath);
  return zipPath;
}

test('installOverrides writes missing defaults and keeps player edits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-overrides-'));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'config'), { recursive: true });
  fs.writeFileSync(path.join(game, 'config', 'sodium-options.json'), '{"mine":true}', 'utf8');
  const zipPath = makeZip(dir, {
    'config/sodium-options.json': '{"pack":true}',
    'config/lumymon.json': '{"initialScreenVersion":3}',
    'datapacks/karamon.zip': 'bin',
  });

  const result = installOverrides(zipPath, game);

  assert.equal(fs.readFileSync(path.join(game, 'config', 'sodium-options.json'), 'utf8'), '{"mine":true}');
  assert.equal(fs.readFileSync(path.join(game, 'config', 'lumymon.json'), 'utf8'), '{"initialScreenVersion":3}');
  assert.ok(fs.existsSync(path.join(game, 'datapacks', 'karamon.zip')));
  assert.deepEqual(result, { written: 2, kept: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('installOverrides always refreshes FancyMenu layouts and assets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-overrides-'));
  const game = path.join(dir, 'game');
  const layout = path.join(game, 'config', 'fancymenu', 'customization', 'cobbleverse_main.txt');
  fs.mkdirSync(path.dirname(layout), { recursive: true });
  fs.writeFileSync(layout, 'old', 'utf8');
  const zipPath = makeZip(dir, {
    'config/fancymenu/customization/cobbleverse_main.txt': 'new',
    'config/fancymenu/assets/karamon_title.png': 'png',
    'config/fancymenu/user_variables.db': 'state',
    'mods/should-not-land.jar': 'jar',
  });

  const result = installOverrides(zipPath, game);

  assert.equal(fs.readFileSync(layout, 'utf8'), 'new');
  assert.ok(fs.existsSync(path.join(game, 'config', 'fancymenu', 'assets', 'karamon_title.png')));
  assert.ok(!fs.existsSync(path.join(game, 'config', 'fancymenu', 'user_variables.db')));
  assert.ok(!fs.existsSync(path.join(game, 'mods', 'should-not-land.jar')));
  assert.deepEqual(result, { written: 2, kept: 0 });

  const again = installOverrides(zipPath, game);
  assert.deepEqual(again, { written: 0, kept: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('helpers normalize names and classify forced prefixes', () => {
  assert.equal(normalizeOverridePath('.\\config\\fancymenu\\options.txt'), 'config/fancymenu/options.txt');
  assert.equal(isForcedOverride('config/fancymenu/customization/x.txt'), true);
  assert.equal(isForcedOverride('config/fancymenu/options.txt'), true);
  assert.equal(isForcedOverride('config/cobblemon/main.json'), false);
});
