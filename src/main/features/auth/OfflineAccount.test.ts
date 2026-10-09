import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mojangNameStatus, offlineUuid } from './OfflineAccount.ts';

// Reference values from Java: UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))
test('the offline UUID is the one Minecraft computes', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.equal(offlineUuid('Steve'), '5627dd98-e6be-3c21-b8a8-e92344183641');
  assert.equal(offlineUuid('Kara_42'), '1c819e17-633a-344c-b509-9ab2be8d1b6d');
});

test('the name is hashed as UTF-8 and case matters', () => {
  assert.equal(offlineUuid('éa'), 'e786ceab-3803-3f95-9290-2bf7c72b332a');
  assert.notEqual(offlineUuid('notch'), offlineUuid('Notch'));
});

test('the offline UUID is version 3 with the IETF variant', () => {
  for (const name of ['Notch', 'abc', 'ABCDEFGHIJKLMNOP', '___']) {
    const id = offlineUuid(name);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

const answering = (status: number) => async () => ({ status });

test('Mojang answering 200 means the name is taken', async () => {
  assert.equal(await mojangNameStatus('Notch', answering(200)), 'taken');
});

test('Mojang answering 404 or 204 means the name is free', async () => {
  assert.equal(await mojangNameStatus('zzqx_karamon', answering(404)), 'free');
  assert.equal(await mojangNameStatus('zzqx_karamon', answering(204)), 'free');
});

test('an error, a rate limit or no network leaves the answer unknown', async () => {
  assert.equal(await mojangNameStatus('Kara', answering(429)), 'unknown');
  assert.equal(await mojangNameStatus('Kara', answering(503)), 'unknown');
  assert.equal(
    await mojangNameStatus('Kara', async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }),
    'unknown',
  );
});

test('the name is put in the URL encoded', async () => {
  let seen = '';
  await mojangNameStatus('a_b', async (url) => {
    seen = url;
    return { status: 404 };
  });
  assert.equal(seen, 'https://api.minecraftservices.com/minecraft/profile/lookup/name/a_b');
});
