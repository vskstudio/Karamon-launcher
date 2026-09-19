import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { OptionsWriter } from './OptionsWriter.ts';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'content', 'client-options.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('content/client-options.json introuvable depuis ' + start);
}

const ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CLIENT_OPTIONS = path.join(ROOT, 'content', 'client-options.json');

test('client-options.json pins Karamon UI on top of the current stack', () => {
  const opts = JSON.parse(fs.readFileSync(CLIENT_OPTIONS, 'utf8')) as {
    resourcePacks: string[];
    shaderPack: string;
  };
  assert.equal(opts.resourcePacks.at(-1), 'file/Karamon UI');
  assert.equal(opts.resourcePacks.at(-2), 'file/bushy-leaves-1-6-5.zip');
  assert.equal(opts.resourcePacks.at(-3), 'file/COBBLEVERSE RP [CF].zip');
  assert.equal(opts.shaderPack, 'COBBLEVERSE - Shaders');
  const idxInterface = opts.resourcePacks.indexOf('file/Cobblemon Interface v1.6.0.zip');
  const idxModded = opts.resourcePacks.indexOf('file/Cobblemon Interface Modded v1.9.4.zip');
  assert.ok(idxInterface >= 0 && idxModded === idxInterface + 1);
});

test('forceResourcePacks rewrites the list instead of appending', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-options-'));
  fs.writeFileSync(
    path.join(dir, 'options.txt'),
    'fov:0.0\nresourcePacks:["vanilla","file/Old.zip"]\nlanguage:fr_fr\n',
    'utf8',
  );
  const writer = new OptionsWriter(dir);
  writer.forceResourcePacks(['vanilla', 'fabric', 'file/Karamon UI']);
  const text = fs.readFileSync(path.join(dir, 'options.txt'), 'utf8');
  assert.match(text, /resourcePacks:\["vanilla","fabric","file\/Karamon UI"\]/);
  assert.doesNotMatch(text, /Old\.zip/);
  assert.match(text, /fov:0.0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ensureShader overwrites the Iris pack name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-iris-'));
  const iris = path.join(dir, 'config', 'iris.properties');
  fs.mkdirSync(path.dirname(iris), { recursive: true });
  fs.writeFileSync(iris, 'enableShaders=false\nshaderPack=OFF\n', 'utf8');
  new OptionsWriter(dir).ensureShader('COBBLEVERSE - Shaders', true);
  const text = fs.readFileSync(iris, 'utf8');
  assert.match(text, /^shaderPack=COBBLEVERSE - Shaders$/m);
  assert.match(text, /^enableShaders=true$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});
