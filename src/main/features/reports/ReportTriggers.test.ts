import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LaunchPhaseError, exitTrigger, failureTrigger, failureSummary } from './ReportTriggers.ts';

const MIN = 60 * 1000;

test('une sortie non nulle avant deux minutes est un crash précoce, après un crash', () => {
  assert.equal(exitTrigger(1, 0, 30_000), 'crash_early');
  assert.equal(exitTrigger(-1, 0, 2 * MIN), 'crash_early');
  assert.equal(exitTrigger(1, 0, 2 * MIN + 1), 'crash');
  assert.equal(exitTrigger(null, 0, 10 * MIN), 'crash');
});

test('une sortie normale ne produit aucun rapport', () => {
  assert.equal(exitTrigger(0, 0, 1_000), null);
  assert.equal(exitTrigger(0, 0, 60 * MIN), null);
});

test('un échec de synchronisation pendant Jouer reste sync_failed', () => {
  const error = new LaunchPhaseError('sync', new Error('HTTP 503 sur pack.json'));
  assert.equal(error.message, 'HTTP 503 sur pack.json');
  assert.equal(failureTrigger(error), 'sync_failed');
});

test('Java, librairies et spawn sont launch_failed, même sans erreur typée', () => {
  assert.equal(failureTrigger(new LaunchPhaseError('launch', new Error('Java introuvable'))), 'launch_failed');
  assert.equal(failureTrigger(new Error('spawn ENOENT')), 'launch_failed');
  assert.equal(failureTrigger('texte brut'), 'launch_failed');
});

test('le résumé nomme la phase et garde le message', () => {
  assert.deepEqual(failureSummary(new LaunchPhaseError('sync', new Error('Réseau coupé'))), ['Synchronisation du pack', 'Réseau coupé']);
  assert.deepEqual(failureSummary(new Error('Java introuvable')), ['Lancement du jeu', 'Java introuvable']);
});
