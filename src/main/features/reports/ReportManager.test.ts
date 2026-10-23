import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ReportManager } from './ReportManager.ts';
import { MAX_FAILED_DELIVERIES, ReportQueue } from './ReportQueue.ts';
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

test('un même rapport n’est jamais envoyé deux fois en parallèle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-manager-'));
  const queue = new ReportQueue(root);
  let posts = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = new ReportManager({
    collector: { collect: async () => { throw new Error('inutile'); } },
    queue,
    transport: { send: async () => { posts++; await gate; return 'sent'; } },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => true,
    setAutoSend: () => {},
    requestConsent: () => {},
  });
  queue.enqueue({
    reportId: 'abcdef12-e89b-42d3-a456-426614174000', launcherVersion: '2.1', packVersion: '0.9', os: 'linux', arch: 'x64',
    javaVersion: '21', ramMb: 8192, trigger: 'crash', summary: ['x'], files: [],
  }, 'approved');
  const first = manager.start();
  const second = manager.start();
  release();
  await Promise.all([first, second]);
  assert.equal(posts, 1);
  assert.equal(queue.list().length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('une erreur du transport reste silencieuse et garde le rapport', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-manager-'));
  const queue = new ReportQueue(root);
  const manager = new ReportManager({
    collector: { collect: async ({ trigger, summary }) => ({
      reportId: 'fedcba98-e89b-42d3-a456-426614174000', launcherVersion: '2.1', packVersion: '0.9', os: 'linux', arch: 'x64',
      javaVersion: '21', ramMb: 8192, trigger, summary, files: [],
    }) },
    queue,
    transport: { send: async () => { throw new Error('boum'); } },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => true,
    setAutoSend: () => {},
    requestConsent: () => {},
  });
  assert.deepEqual(await manager.detect('crash', ['x']), { status: 'queued', code: 'fedcba98' });
  assert.equal(queue.list('approved').length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('abandonne un rapport après cinq envois ratés', async () => {
  const f = setup();
  f.setTransport('retry');
  assert.equal((await f.manager.sendManual()).status, 'queued');
  for (let failed = 2; failed < MAX_FAILED_DELIVERIES; failed++) await f.manager.start();
  assert.equal(f.queue.list('approved').length, 1);
  await f.manager.start();
  assert.equal(f.queue.list().length, 0);
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
