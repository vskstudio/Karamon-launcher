import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportResultMessage } from './ReportMessages.ts';

test('un envoi réussi montre le code court', () => {
  assert.deepEqual(reportResultMessage({ status: 'sent', code: 'ab12cd34' }), {
    text: "Rapport envoyé à l'équipe Karamon. Code : ab12cd34",
    tone: 'ok',
  });
});

test('hors ligne, le même code est montré avec l’attente du prochain lancement', () => {
  assert.deepEqual(reportResultMessage({ status: 'queued', code: 'ab12cd34' }), {
    text: 'Rapport prêt, il partira au prochain lancement du launcher. Code : ab12cd34',
    tone: 'info',
  });
});

test('un échec ou un refus ne montre rien au joueur', () => {
  assert.equal(reportResultMessage({ status: 'failed', code: 'ab12cd34' }), null);
  assert.equal(reportResultMessage({ status: 'failed' }), null);
  assert.equal(reportResultMessage({ status: 'skipped', code: 'ab12cd34' }), null);
  assert.equal(reportResultMessage({ status: 'sent' }), null, 'pas de message sans code');
});
