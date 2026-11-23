import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { resetSkin, saveSkin, savedSkinDataUrl } from './OfflineSkin.ts';
import { SKIN_MAX_BYTES_ACCEPTED_BY_KARAMON_MOD } from '../../../shared/Karamon.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';

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

test('only 64x64 or 64x32 PNGs of 32 KB at most are saved as skins', () => {
  const instance = new GameInstance(makeTempDir('skin-'));
  const save = (png: Buffer) => () => saveSkin(instance, 'Zoe_42', png, 'classic');
  assert.doesNotThrow(save(png(64, 64)));
  assert.doesNotThrow(save(png(64, 32)));
  assert.throws(save(png(128, 128)), /64 × 64/);
  assert.throws(save(Buffer.from('GIF89a......................')), /PNG/);
  assert.throws(save(Buffer.alloc(SKIN_MAX_BYTES_ACCEPTED_BY_KARAMON_MOD + 1)), /32 Ko/);
});

test('saves what the mod reads, and a reset is a one-shot default', () => {
  const dir = makeTempDir('skin-');
  const instance = new GameInstance(dir);
  saveSkin(instance, 'Zoe_42', png(64, 64), 'slim');
  const skins = path.join(dir, 'karamon', 'skins');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(skins, 'zoe_42.json'), 'utf8')), { mode: 'custom', model: 'slim' });
  assert.ok(savedSkinDataUrl(instance, 'Zoe_42')?.startsWith('data:image/png;base64,'));
  resetSkin(instance, 'Zoe_42');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(skins, 'zoe_42.json'), 'utf8')), { mode: 'default' });
  assert.equal(fs.existsSync(path.join(skins, 'zoe_42.png')), false);
  assert.equal(savedSkinDataUrl(instance, 'Zoe_42'), null);
  assert.throws(() => saveSkin(instance, '../evil', png(64, 64), 'classic'), /Pseudo invalide/);
  assert.throws(() => saveSkin(instance, 'Zoe_42', png(10, 10), 'classic'), /64 × 64/);
});
