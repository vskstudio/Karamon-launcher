import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hideWhileSaving } from './hideWhileSaving.ts';

test('une suggestion refusée à l’enregistrement revient, avec le message de l’erreur', async () => {
  const suggestion = { value: { reasons: ['8 Go de RAM'] } as { reasons: string[] } | null };
  const outcome = await hideWhileSaving(suggestion, null, async () => {
    throw new Error("Tes réglages sont illisibles pour l'instant (fichier verrouillé ?). Réessaie dans un instant.");
  });
  assert.deepEqual(outcome, { ok: false, error: "Tes réglages sont illisibles pour l'instant (fichier verrouillé ?). Réessaie dans un instant." });
  assert.deepEqual(suggestion.value, { reasons: ['8 Go de RAM'] });
});

test('une suggestion enregistrée reste masquée', async () => {
  const suggestion = { value: { reasons: ['8 Go de RAM'] } as { reasons: string[] } | null };
  let hiddenDuringSave: unknown = 'pas appelé';
  const outcome = await hideWhileSaving(suggestion, null, async () => {
    hiddenDuringSave = suggestion.value;
  });
  assert.deepEqual(outcome, { ok: true });
  assert.equal(hiddenDuringSave, null);
  assert.equal(suggestion.value, null);
});
