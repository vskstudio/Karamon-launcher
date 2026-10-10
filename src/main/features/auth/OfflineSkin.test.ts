import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pngSize, resetSkin, saveSkin, savedSkinDataUrl, skinProblem, SKIN_MAX_BYTES } from './OfflineSkin.ts';

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test('only 64x64 or 64x32 PNGs of 32 KB at most are skins', () => {
  assert.deepEqual(pngSize(png(64, 32)), { width: 64, height: 32 });
  assert.equal(skinProblem(png(64, 64)), null);
  assert.equal(skinProblem(png(64, 32)), null);
  assert.match(skinProblem(png(128, 128)) ?? '', /64 × 64/);
  assert.match(skinProblem(Buffer.from('GIF89a......................')) ?? '', /PNG/);
  assert.match(skinProblem(Buffer.alloc(SKIN_MAX_BYTES + 1)) ?? '', /32 Ko/);
});

test('saves what the mod reads, and a reset is a one-shot default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-'));
  saveSkin(dir, 'Zoe_42', png(64, 64), 'slim');
  const skins = path.join(dir, 'karamon', 'skins');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(skins, 'zoe_42.json'), 'utf8')), { mode: 'custom', model: 'slim' });
  assert.ok(savedSkinDataUrl(dir, 'Zoe_42')?.startsWith('data:image/png;base64,'));
  resetSkin(dir, 'Zoe_42');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(skins, 'zoe_42.json'), 'utf8')), { mode: 'default' });
  assert.equal(fs.existsSync(path.join(skins, 'zoe_42.png')), false);
  assert.equal(savedSkinDataUrl(dir, 'Zoe_42'), null);
  assert.throws(() => saveSkin(dir, '../evil', png(64, 64), 'classic'), /Pseudo invalide/);
  assert.throws(() => saveSkin(dir, 'Zoe_42', png(10, 10), 'classic'), /64 × 64/);
});
