import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skinUrlFromElyTextures, skinUrlFromProfile } from './SkinLookup.ts';

const profile = (textures: unknown) => ({
  id: '853c80ef3c3749fdaa49938b674adae6',
  name: 'jeb_',
  properties: [{ name: 'textures', value: Buffer.from(JSON.stringify(textures)).toString('base64') }],
});

test('the skin URL is read from the textures property and served over HTTPS', () => {
  const url = skinUrlFromProfile(
    profile({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/7fd9ba42a7c81eeea22f' } } }),
  );
  assert.equal(url, 'https://textures.minecraft.net/texture/7fd9ba42a7c81eeea22f');
});

test('a player without a custom skin has no skin URL', () => {
  assert.equal(skinUrlFromProfile(profile({ textures: {} })), null);
});

test('a skin hosted anywhere but textures.minecraft.net is refused', () => {
  assert.equal(skinUrlFromProfile(profile({ textures: { SKIN: { url: 'https://evil.example/texture/abc' } } })), null);
});

test('a malformed profile yields no skin', () => {
  assert.equal(skinUrlFromProfile({ properties: [{ name: 'textures', value: 'not base64 json' }] }), null);
  assert.equal(skinUrlFromProfile({ errorMessage: 'Not Found' }), null);
  assert.equal(skinUrlFromProfile(null), null);
});

test('an Ely.by skin is read from its textures answer and served over HTTPS', () => {
  assert.equal(
    skinUrlFromElyTextures({ SKIN: { url: 'http://ely.by/storage/skins/69c6740d2993e5d6f6a7fc92420efc29.png' } }),
    'https://ely.by/storage/skins/69c6740d2993e5d6f6a7fc92420efc29.png',
  );
  assert.equal(
    skinUrlFromElyTextures({ SKIN: { url: 'http://textures.minecraft.net/texture/292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680' } }),
    'https://textures.minecraft.net/texture/292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680',
  );
});

test('an Ely.by answer without skin, or pointing elsewhere, yields the default head', () => {
  assert.equal(skinUrlFromElyTextures({}), null);
  assert.equal(skinUrlFromElyTextures(null), null);
  assert.equal(skinUrlFromElyTextures({ SKIN: { url: 'https://evil.example/storage/skins/a.png' } }), null);
  assert.equal(skinUrlFromElyTextures({ SKIN: { url: 'https://ely.by.evil.example/storage/skins/a.png' } }), null);
});
