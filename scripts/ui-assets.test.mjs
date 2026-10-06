import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every image index.html loads exists under assets/ui, which the installer ships', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/src="\.\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    assert.ok(ref.startsWith('assets/ui/'), `${ref} hors de assets/ui/, absent de l'installeur`);
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} introuvable`);
  }
});

test('the window icon ships with the installer', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'icon.ico')));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'ui', 'icon-256.png')));
});
