import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidOfflineName, offlineNameProblem } from './OfflineName.ts';

test('names of 3 to 16 letters, digits and underscores are valid', () => {
  for (const name of ['abc', 'Kara_42', '___', 'ABCDEFGHIJKLMNOP', 'x_Y_z_0', '123']) {
    assert.equal(isValidOfflineName(name), true, name);
    assert.equal(offlineNameProblem(name), null, name);
  }
});

test('too short and too long names are refused', () => {
  assert.equal(isValidOfflineName('ab'), false);
  assert.equal(isValidOfflineName('ABCDEFGHIJKLMNOPQ'), false);
  assert.equal(offlineNameProblem('ab'), 'Au moins 3 caractères.');
  assert.equal(offlineNameProblem('ABCDEFGHIJKLMNOPQ'), '16 caractères au plus.');
});

test('an empty name asks for one', () => {
  assert.equal(isValidOfflineName(''), false);
  assert.equal(offlineNameProblem(''), 'Choisis un pseudo.');
});

test('accents, spaces, dashes and other symbols are refused', () => {
  for (const name of ['Élodie', 'ma cro', 'kara-42', 'kara.42', 'kara!', 'ñandú', '名前名前']) {
    assert.equal(isValidOfflineName(name), false, name);
    assert.notEqual(offlineNameProblem(name), null, name);
  }
  assert.equal(offlineNameProblem('ma cro'), 'Pas d’espace : lettres, chiffres et _ seulement.');
  assert.equal(offlineNameProblem('Élodie'), 'Lettres sans accent, chiffres et _ seulement.');
});

test('a name with a trailing newline is not valid', () => {
  assert.equal(isValidOfflineName('Kara\n'), false);
});
