import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routes } from './contract.ts';
import { fileName, httpUrl, InvalidRequest, playerName, wikiSlug } from './RequestDecoders.ts';

test('text decoders refuse what is not a bounded, non-empty string', () => {
  for (const input of [undefined, null, 42, {}, ['a.txt'], '', '   ', 'x'.repeat(256)]) {
    assert.throws(() => fileName(input), InvalidRequest, String(input));
  }
  assert.equal(fileName('crash-2026-11-23.txt'), 'crash-2026-11-23.txt');
});

test('a player name keeps the characters the auth feature explains to the player', () => {
  assert.equal(playerName('Pas d espace'), 'Pas d espace');
  assert.throws(() => playerName('x'.repeat(65)), InvalidRequest);
});

test('only http and https addresses are accepted for the browser', () => {
  assert.equal(httpUrl('https://karamon.fr/wiki'), 'https://karamon.fr/wiki');
  for (const input of ['file:///etc/passwd', 'javascript:alert(1)', 'karamon.fr', `https://${'a'.repeat(2048)}`]) {
    assert.throws(() => httpUrl(input), InvalidRequest, input);
  }
});

test('a wiki slug cannot point outside the wiki', () => {
  assert.equal(wikiSlug('mondes-et-dimensions'), 'mondes-et-dimensions');
  for (const input of ['../../config', 'Mondes', 'a/b', '']) assert.throws(() => wikiSlug(input), InvalidRequest, input);
});

test('a consent answer only sends when the player said yes explicitly', () => {
  const reportId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(routes.answerReportConsent.decode({ reportId, send: 'true', always: 1 }), {
    reportId,
    send: false,
    always: false,
  });
  assert.deepEqual(routes.answerReportConsent.decode({ reportId, send: true, always: true, extra: 'ignored' }), {
    reportId,
    send: true,
    always: true,
  });
  assert.throws(() => routes.answerReportConsent.decode({ send: true }), InvalidRequest);
  assert.throws(() => routes.answerReportConsent.decode('oui'), InvalidRequest);
});

test('an offline skin request needs a known arm model and an image', () => {
  const request = { name: 'Kara_42', png: 'iVBORw0KGgo=', model: 'slim' };
  assert.deepEqual(routes.skinOfflineSet.decode(request), request);
  assert.throws(() => routes.skinOfflineSet.decode({ ...request, model: 'wide' }), InvalidRequest);
  assert.throws(() => routes.skinOfflineSet.decode({ ...request, png: 'x'.repeat(64 * 1024 + 1) }), InvalidRequest);
});

test('settings must arrive as an object', () => {
  assert.deepEqual(routes.saveConfig.decode({ potatoMode: true }), { potatoMode: true });
  for (const input of [null, 'potato', [true]]) assert.throws(() => routes.saveConfig.decode(input), InvalidRequest);
});
