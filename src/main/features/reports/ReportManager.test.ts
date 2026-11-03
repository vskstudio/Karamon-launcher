import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAX_SEND_ATTEMPTS, ReportManager } from './ReportManager.ts';
import { ReportQueue } from './ReportQueue.ts';
import type { ReportTransportResult } from './ReportTransport.ts';
import type { LauncherReport, ReportTrigger } from './ReportTypes.ts';

const SENT: ReportTransportResult = { kind: 'sent', serverId: 'ab12cd34-e89b-42d3-a456-426614174000' };
const RETRY: ReportTransportResult = { kind: 'retry', reason: 'réseau indisponible', retryAfterMs: null };

function setup(options: { automatic?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-manager-'));
  const queue = new ReportQueue(root);
  let automatic = options.automatic ?? false;
  let transport: ReportTransportResult | Error = SENT;
  let clock = 1_000_000;
  let next = 1;
  let collects = 0;
  let posts = 0;
  const consent: Array<{ reportId: string; trigger: ReportTrigger; summary: string[] }> = [];
  const manager = new ReportManager({
    collector: {
      collect: async ({ trigger, summary }): Promise<LauncherReport> => {
        collects++;
        return {
          reportId: `1234567${next++}-e89b-42d3-a456-426614174000`,
          launcherVersion: '2.1', packVersion: '0.9', os: 'linux', arch: 'x64', javaVersion: '21', ramMb: 8192,
          trigger, summary, files: [],
        };
      },
    },
    queue,
    transport: {
      send: async () => {
        posts++;
        if (transport instanceof Error) throw transport;
        return transport;
      },
    },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => automatic,
    setAutoSend: (value) => { automatic = value; },
    requestConsent: (request) => { consent.push(request); },
    now: () => clock,
  });
  return {
    root, queue, manager, consent,
    automatic: () => automatic,
    setTransport: (value: ReportTransportResult | Error) => { transport = value; },
    advance: (ms: number) => { clock += ms; },
    now: () => clock,
    counts: () => ({ collects, posts }),
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('une détection sans envoi automatique attend le consentement, refuser supprime', async () => {
  const f = setup();
  const result = await f.manager.detect('crash', ['Erreur GPU']);
  assert.deepEqual(result, { status: 'queued', nextAttemptAt: null });
  assert.deepEqual(f.consent, [{ reportId: '12345671-e89b-42d3-a456-426614174000', trigger: 'crash', summary: ['Erreur GPU'] }]);
  assert.equal(f.counts().posts, 0, 'rien ne sort sans le oui du joueur');
  const declined = await f.manager.answerConsent(f.consent[0].reportId, false, false);
  assert.deepEqual(declined, { status: 'skipped', reason: 'declined' });
  assert.equal(f.queue.list(undefined, f.now()).length, 0);
  f.done();
});

test('le code support vient du serveur après acceptation', async () => {
  const f = setup();
  await f.manager.detect('crash', ['x']);
  const sent = await f.manager.answerConsent(f.consent[0].reportId, true, false);
  assert.deepEqual(sent, { status: 'sent', supportCode: 'AB12CD34' });
  f.setTransport({ kind: 'sent', serverId: null });
  assert.deepEqual(await f.manager.sendManual(), { status: 'sent', supportCode: null });
  f.done();
});

test('le main refuse une réponse pour un rapport inconnu ou déjà traité', async () => {
  const f = setup();
  assert.deepEqual(await f.manager.answerConsent('pas-un-rapport', true, true), { status: 'skipped', reason: 'unknown_report' });
  assert.equal(f.automatic(), false, 'une réponse invalide n’active pas le réglage');
  await f.manager.detect('crash', ['x']);
  const id = f.consent[0].reportId;
  await f.manager.answerConsent(id, true, false);
  assert.deepEqual(await f.manager.answerConsent(id, true, false), { status: 'skipped', reason: 'unknown_report' });
  assert.equal(f.counts().posts, 1);
  f.done();
});

test('toujours envoyer active le réglage et met en attente hors ligne', async () => {
  const f = setup();
  f.setTransport(RETRY);
  await f.manager.detect('crash_early', ['Crash tôt']);
  const result = await f.manager.answerConsent(f.consent[0].reportId, true, true);
  assert.equal(result.status, 'queued');
  assert.ok(result.status === 'queued' && result.nextAttemptAt! > f.now());
  assert.equal(f.automatic(), true);
  assert.equal(f.queue.list('approved', f.now()).length, 1);
  const second = await f.manager.detect('sync_failed', ['Réseau']);
  assert.equal(second.status, 'queued');
  assert.equal(f.consent.length, 1, 'plus de dialogue en mode automatique');
  f.done();
});

test('un échec d’envoi ne crée jamais de nouveau rapport', async () => {
  const f = setup({ automatic: true });
  f.setTransport(new Error('boum'));
  const result = await f.manager.detect('crash', ['x']);
  assert.equal(result.status, 'queued');
  f.advance(24 * 60 * 60 * 1000);
  await f.manager.start();
  assert.equal(f.counts().collects, 1);
  assert.equal(f.queue.list('approved', f.now()).length, 1);
  f.done();
});

test('respecte Retry-After et abandonne après cinq tentatives', async () => {
  const f = setup({ automatic: true });
  f.setTransport({ kind: 'retry', reason: 'HTTP 429', retryAfterMs: 3 * 60 * 60 * 1000 });
  const first = await f.manager.detect('crash', ['x']);
  assert.deepEqual(first, { status: 'queued', nextAttemptAt: f.now() + 3 * 60 * 60 * 1000 });

  await f.manager.start();
  assert.equal(f.counts().posts, 1, 'pas de nouvel essai avant la date annoncée');

  f.setTransport(RETRY);
  for (let attempt = 2; attempt < MAX_SEND_ATTEMPTS; attempt++) {
    f.advance(24 * 60 * 60 * 1000);
    await f.manager.start();
    assert.equal(f.counts().posts, attempt);
    assert.equal(f.queue.list('approved', f.now()).length, 1);
  }
  f.advance(24 * 60 * 60 * 1000);
  await f.manager.start();
  assert.equal(f.counts().posts, MAX_SEND_ATTEMPTS);
  assert.equal(f.queue.list(undefined, f.now()).length, 0, 'abandon après la cinquième tentative');
  f.done();
});

test('un refus définitif du panel supprime le rapport', async () => {
  const f = setup({ automatic: true });
  f.setTransport({ kind: 'discard', reason: 'HTTP 400' });
  assert.deepEqual(await f.manager.detect('crash', ['x']), { status: 'failed', reason: 'HTTP 400', retryable: false });
  assert.equal(f.queue.list(undefined, f.now()).length, 0);
  f.done();
});

test('limite les doublons automatiques par type', async () => {
  const f = setup();
  await f.manager.detect('crash', ['premier']);
  f.advance(60_000);
  assert.deepEqual(await f.manager.detect('crash', ['doublon']), { status: 'skipped', reason: 'cooldown' });
  assert.equal((await f.manager.detect('sync_failed', ['autre type'])).status, 'queued');
  f.done();
});

test('l’envoi manuel est limité à trois par tranche de dix minutes', async () => {
  const f = setup();
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.manager.sendManual()).status, 'sent');
    f.advance(1_000);
  }
  assert.deepEqual(await f.manager.sendManual(), { status: 'skipped', reason: 'manual_limit' });
  assert.equal(f.counts().collects, 3, 'pas de collecte au-delà de la limite');
  f.advance(10 * 60 * 1000);
  assert.equal((await f.manager.sendManual()).status, 'sent');
  f.done();
});

test('désactiver le réglage supprime les rapports approuvés non envoyés', async () => {
  const f = setup({ automatic: true });
  f.setTransport(RETRY);
  await f.manager.detect('crash', ['x']);
  await f.manager.sendManual();
  assert.equal(f.queue.list('approved', f.now()).length, 2);
  f.manager.autoSendDisabled();
  assert.equal(f.queue.list(undefined, f.now()).length, 0);
  f.done();
});

test('un même rapport n’est jamais envoyé deux fois en parallèle', async () => {
  const f = setup();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let posts = 0;
  const manager = new ReportManager({
    collector: { collect: async () => { throw new Error('inutile'); } },
    queue: f.queue,
    transport: { send: async () => { posts++; await gate; return SENT; } },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => true,
    setAutoSend: () => {},
    requestConsent: () => {},
    now: f.now,
  });
  f.queue.enqueue({
    reportId: 'abcdef12-e89b-42d3-a456-426614174000', launcherVersion: '2.1', packVersion: '0.9', os: 'linux', arch: 'x64',
    javaVersion: '21', ramMb: 8192, trigger: 'crash', summary: ['x'], files: [],
  }, 'approved', f.now());
  const first = manager.start();
  const second = manager.start();
  release();
  await Promise.all([first, second]);
  assert.equal(posts, 1);
  assert.equal(f.queue.list(undefined, f.now()).length, 0);
  f.done();
});

test('une collecte qui échoue reste silencieuse', async () => {
  const f = setup();
  const manager = new ReportManager({
    collector: { collect: async () => { throw new Error('disque plein'); } },
    queue: f.queue,
    transport: { send: async () => SENT },
    context: () => ({ gameDir: '/game', ramMb: 8192 }),
    autoSend: () => true,
    setAutoSend: () => {},
    requestConsent: () => {},
    now: f.now,
  });
  assert.deepEqual(await manager.detect('crash', ['x']), { status: 'failed', reason: 'collecte impossible', retryable: false });
  f.done();
});

test('au démarrage réessaie les approuvés et repropose les consentements', async () => {
  const f = setup();
  f.setTransport(RETRY);
  await f.manager.sendManual();
  await f.manager.detect('launch_failed', ['Java absent']);
  assert.equal(f.queue.list(undefined, f.now()).length, 2);
  f.setTransport(SENT);
  f.consent.length = 0;
  f.advance(24 * 60 * 60 * 1000);
  await f.manager.start();
  assert.equal(f.queue.list('approved', f.now()).length, 0);
  assert.deepEqual(f.consent.map((item) => item.trigger), ['launch_failed']);
  f.done();
});
