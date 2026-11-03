import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedSettings } from './changedSettings.ts';

test('n’envoie que les réglages modifiés sur la page', () => {
  assert.deepEqual(
    changedSettings({ memoryMb: 4096, autoSendReports: false }, { memoryMb: 6144, autoSendReports: false }),
    { memoryMb: 6144 },
  );
});

test('un réglage non touché ne peut pas écraser un changement fait ailleurs (« Toujours envoyer »)', () => {
  const update = changedSettings({ memoryMb: 4096, autoSendReports: false }, { memoryMb: 8192, autoSendReports: false });
  assert.ok(!('autoSendReports' in update));
});

test('rien à envoyer quand rien n’a changé', () => {
  assert.deepEqual(changedSettings({ devMode: true }, { devMode: true }), {});
});
