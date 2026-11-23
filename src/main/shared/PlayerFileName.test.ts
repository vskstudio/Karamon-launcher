import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'path';
import { playerFileIn } from './PlayerFileName.ts';

test('un nom de fichier envoyé par la fenêtre reste dans son dossier', () => {
  const folder = path.join('/jeu', 'screenshots');
  assert.equal(playerFileIn(folder, '2026-11-23_12.00.00.png'), path.join(folder, '2026-11-23_12.00.00.png'));
  assert.equal(playerFileIn(folder, 'crash..2026.txt'), path.join(folder, 'crash..2026.txt'));
  for (const refused of ['', '.', '..', '../options.txt', '..\\options.txt', 'saves/monde', 'a\0b', 42, undefined]) {
    assert.throws(() => playerFileIn(folder, refused), /Nom invalide/, String(refused));
  }
});
