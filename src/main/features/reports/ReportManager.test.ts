import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ReportManager } from './ReportManager.ts';
import { ReportQueue } from './ReportQueue.ts';
import type { LauncherReport, ReportTrigger } from './ReportTypes.ts';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-manager-'));
  const queue = new ReportQueue(root);
  let automatic = false;
  let transport: 'sent' | 'retry' | 'discard' = 'sent';
  let next = 1;
  const consent: Array<{ reportId: string; trigger: ReportTrigger; summary: string[] }> = [];
  const manager = new ReportManager({
    collector: {
      collect: async ({ trigger, summary }): Promise<LauncherReport> => ({
        reportId: `1234567${next++}-e89b-42d3-a456-426614174000`,
        launcherVersion: '2.1', packVersion: '0.9', os: 'linux', arch: 'x64', javaVersion: '21', ramMb: 8192,
        trigger, summary, files: [],
      }),
    },
    queue,
    transport: { send: async () => transport },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => automatic,
    setAutoSend: (value) => { automatic = value; },
    requestConsent: (request) => { consent.push(request); },
  });
  return { root, queue, manager, consent, automatic: () => automatic, setTransport: (value: typeof transport) => { transport = value; } };
}

test('une détection sans envoi automatique attend le consentement', async () => {
  const f = setup();
  const result = await f.manager.detect('crash', ['Erreur GPU']);
  assert.deepEqual(result, { status: 'queued', code: '12345671' });
  assert.deepEqual(f.consent, [{ reportId: '12345671-e89b-42d3-a456-426614174000', trigger: 'crash', summary: ['Erreur GPU'] }]);
  assert.equal(f.queue.list('awaiting-consent').length, 1);
  const declined = await f.manager.answerConsent(f.consent[0].reportId, false, false);
  assert.deepEqual(declined, { status: 'skipped', code: '12345671' });
  assert.equal(f.queue.list().length, 0);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('toujours envoyer active le réglage et garde hors-ligne le même code', async () => {
  const f = setup();
  f.setTransport('retry');
  await f.manager.detect('crash_early', ['Crash tôt']);
  const result = await f.manager.answerConsent(f.consent[0].reportId, true, true);
  assert.deepEqual(result, { status: 'queued', code: '12345671' });
  assert.equal(f.automatic(), true);
  assert.equal(f.queue.list('approved').length, 1);
  const second = await f.manager.detect('sync_failed', ['Réseau']);
  assert.equal(second.status, 'queued');
  assert.equal(f.consent.length, 1, 'plus de dialogue en mode automatique');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('limite les doublons automatiques mais jamais le bouton manuel', async () => {
  const f = setup();
  await f.manager.detect('crash', ['premier'], 1_000);
  assert.equal((await f.manager.detect('crash', ['doublon'], 2_000)).status, 'skipped');
  assert.equal((await f.manager.sendManual()).status, 'sent');
  assert.equal((await f.manager.sendManual()).status, 'sent');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('au démarrage réessaie les approuvés et repropose les consentements', async () => {
  const f = setup();
  f.setTransport('retry');
  await f.manager.sendManual();
  await f.manager.detect('launch_failed', ['Java absent']);
  assert.equal(f.queue.list().length, 2);
  f.setTransport('sent');
  f.consent.length = 0;
  await f.manager.start();
  assert.equal(f.queue.list('approved').length, 0);
  assert.deepEqual(f.consent.map((item) => item.trigger), ['launch_failed']);
  fs.rmSync(f.root, { recursive: true, force: true });
});
