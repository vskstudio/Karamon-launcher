import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSENT_TEXT, reportResultMessage } from './ReportMessages.ts';

test('le texte du consentement est celui de la spec', () => {
  assert.equal(CONSENT_TEXT.question, "Un problème a été détecté. Envoyer le rapport à l'équipe Karamon pour qu'on t'aide ?");
  assert.equal(CONSENT_TEXT.send, 'Envoyer');
  assert.equal(CONSENT_TEXT.later, 'Pas maintenant');
  assert.equal(CONSENT_TEXT.always, 'Toujours envoyer automatiquement');
});

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
