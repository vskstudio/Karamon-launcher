import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSENT_TEXT, reportResultMessage } from './ReportMessages.ts';

test('le refus dit qu’il supprime le rapport', () => {
  assert.equal(CONSENT_TEXT.send, 'Envoyer');
  assert.equal(CONSENT_TEXT.decline, 'Ne pas envoyer');
  assert.equal(CONSENT_TEXT.always, 'Toujours envoyer automatiquement');
  assert.ok(!Object.values(CONSENT_TEXT).some((text) => /pas maintenant/i.test(text)));
});

test('le texte parle de masquage, sans promettre l’anonymat', () => {
  const all = Object.values(CONSENT_TEXT).join(' ');
  assert.match(all, /masqu/);
  assert.ok(!/anonym/i.test(all), all);
  assert.match(all, /pseudo/i, 'le pseudo peut apparaître dans les journaux du jeu : on le dit');
});

test('le code support n’apparaît qu’une fois renvoyé par le serveur', () => {
  assert.deepEqual(reportResultMessage({ status: 'sent', supportCode: 'AB12CD34' }), {
    text: "Rapport envoyé à l'équipe Karamon. Code support : AB12CD34",
    tone: 'ok',
  });
  assert.deepEqual(reportResultMessage({ status: 'sent', supportCode: null }), {
    text: "Rapport envoyé à l'équipe Karamon.",
    tone: 'ok',
  });
});

test('avant l’acceptation du serveur : « en attente » et rien d’autre', () => {
  assert.deepEqual(reportResultMessage({ status: 'queued', nextAttemptAt: 123 }), { text: 'Rapport en attente.', tone: 'info' });
  assert.deepEqual(reportResultMessage({ status: 'queued', nextAttemptAt: null }), { text: 'Rapport en attente.', tone: 'info' });
});

test('la limite d’envoi manuel est expliquée', () => {
  const message = reportResultMessage({ status: 'skipped', reason: 'manual_limit' });
  assert.equal(message?.tone, 'info');
  assert.match(message?.text ?? '', /quelques minutes/);
});

test('un échec ou un refus ne montre rien au joueur', () => {
  assert.equal(reportResultMessage({ status: 'failed', reason: 'HTTP 400', retryable: false }), null);
  assert.equal(reportResultMessage({ status: 'skipped', reason: 'declined' }), null);
  assert.equal(reportResultMessage({ status: 'skipped', reason: 'cooldown' }), null);
  assert.equal(reportResultMessage({ status: 'skipped', reason: 'unknown_report' }), null);
});
