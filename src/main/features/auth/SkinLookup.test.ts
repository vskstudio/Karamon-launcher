import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { SkinLookup } from './SkinLookup.ts';

const PLAYER_ID = '853c80ef3c3749fdaa49938b674adae6';

const profile = (textures: unknown) => ({
  id: PLAYER_ID,
  name: 'jeb_',
  properties: [{ name: 'textures', value: Buffer.from(JSON.stringify(textures)).toString('base64') }],
});

function lookupAnswering(answer: unknown): SkinLookup {
  const http = {
    getJson: async () => answer,
    get: async () => ({ status: 200, body: Buffer.from(JSON.stringify(answer)) }),
  } as unknown as HttpClient;
  return new SkinLookup(http);
}

const mojangSkin = (answer: unknown) => lookupAnswering(answer).skinUrl(PLAYER_ID);
const elySkin = (answer: unknown) => lookupAnswering(answer).elySkinUrl('jeb_');

test('the skin URL is read from the textures property and served over HTTPS', async () => {
  const url = await mojangSkin(profile({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/7fd9ba42a7c81eeea22f' } } }));
  assert.equal(url, 'https://textures.minecraft.net/texture/7fd9ba42a7c81eeea22f');
});

test('a player without a custom skin has no skin URL', async () => {
  assert.equal(await mojangSkin(profile({ textures: {} })), null);
});

test('a skin hosted anywhere but textures.minecraft.net is refused', async () => {
  assert.equal(await mojangSkin(profile({ textures: { SKIN: { url: 'https://evil.example/texture/abc' } } })), null);
});

test('a malformed profile yields no skin', async () => {
  assert.equal(await mojangSkin({ properties: [{ name: 'textures', value: 'not base64 json' }] }), null);
  assert.equal(await mojangSkin({ errorMessage: 'Not Found' }), null);
  assert.equal(await mojangSkin(null), null);
});

test('an Ely.by skin is read from its textures answer and served over HTTPS', async () => {
  assert.equal(
    await elySkin({ SKIN: { url: 'http://ely.by/storage/skins/69c6740d2993e5d6f6a7fc92420efc29.png' } }),
    'https://ely.by/storage/skins/69c6740d2993e5d6f6a7fc92420efc29.png',
  );
  assert.equal(
    await elySkin({ SKIN: { url: 'http://textures.minecraft.net/texture/292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680' } }),
    'https://textures.minecraft.net/texture/292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680',
  );
});

test('an Ely.by answer without skin, or pointing elsewhere, yields the default head', async () => {
  assert.equal(await elySkin({}), null);
  assert.equal(await elySkin(null), null);
  assert.equal(await elySkin({ SKIN: { url: 'https://evil.example/storage/skins/a.png' } }), null);
  assert.equal(await elySkin({ SKIN: { url: 'https://ely.by.evil.example/storage/skins/a.png' } }), null);
});
