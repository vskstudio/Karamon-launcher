import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skinUrlFromProfile } from './SkinLookup.ts';

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
