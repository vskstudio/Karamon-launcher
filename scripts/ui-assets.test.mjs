import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function shippedFiles() {
  const config = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  return [...config.matchAll(/^\s*-\s*"([^"!][^"]*)"/gm)].map((m) => m[1]);
}

test('every file index.html loads ships with the installer', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(?![a-z]+:)([^"]+)"/g)].map((m) => `dist/${m[1]}`);
  assert.ok(refs.length > 0);
  const shipped = shippedFiles();
  for (const ref of refs) {
    assert.ok(shipped.includes(ref), `${ref} absent de l'installeur`);
  }
});

test('the images the renderer bundle emits ship with the installer', () => {
  const build = fs.readFileSync(path.join(ROOT, 'build.mjs'), 'utf8');
  assert.match(build, /assetNames: 'assets\//);
  assert.ok(shippedFiles().includes('dist/assets/**/*'));
});

test('the window icon ships with the installer', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'icon.ico')));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'ui', 'icon-256.png')));
});
