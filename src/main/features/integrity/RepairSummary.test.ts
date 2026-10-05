import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairSummary } from './RepairSummary.ts';

test('résume la réparation pour le joueur', () => {
  assert.equal(repairSummary(0, 0), "Aucun fichier abîmé trouvé : l'installation est saine.");
  assert.equal(repairSummary(1, 0), '1 fichier du pack abîmé a été réinstallé.');
  assert.equal(repairSummary(0, 62), '62 fichiers de configuration abîmés ont été réparés.');
  assert.equal(
    repairSummary(2, 1),
    '2 fichiers du pack abîmés ont été réinstallés, 1 fichier de configuration abîmé a été réparé.',
  );
});
