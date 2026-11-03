import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { MAX_FAILED_DELIVERIES, REPORT_TTL_MS, ReportQueue } from './ReportQueue.ts';
import type { LauncherReport, ReportTrigger } from './ReportTypes.ts';

const DAY = 24 * 60 * 60 * 1000;

function report(id: string, trigger: ReportTrigger = 'crash'): LauncherReport {
  return {
    reportId: id,
    launcherVersion: '2.1.0',
    packVersion: '0.9.5',
    os: 'linux',
    arch: 'x64',
    javaVersion: '21',
    ramMb: 8192,
    trigger,
    summary: [`crash ${id}`],
    files: [],
  };
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-queue-'));
}

function reportFiles(root: string): string[] {
  return fs.readdirSync(path.join(root, 'reports')).filter((name) => name.endsWith('.json.gz'));
}

test('persiste des rapports gzip et leurs états entre deux instances', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'awaiting-consent', 10);
  queue.enqueue(report('b'), 'approved', 20);

  const restored = new ReportQueue(root);
  assert.deepEqual(restored.list(undefined, 30).map((item) => [item.report.reportId, item.state, item.failedDeliveries]), [
    ['a', 'awaiting-consent', 0],
    ['b', 'approved', 0],
  ]);
  assert.deepEqual(restored.list('approved', 30).map((item) => item.report.reportId), ['b']);
  assert.equal(reportFiles(root).length, 2);
  assert.ok(!fs.readdirSync(path.join(root, 'reports')).some((name) => name.includes('karamon-tmp')));

  restored.approve('a', 30);
  assert.equal(new ReportQueue(root).list(undefined, 30)[0].state, 'approved');
  restored.remove('b');
  assert.deepEqual(new ReportQueue(root).list(undefined, 30).map((item) => item.report.reportId), ['a']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dossier en 0700 et fichiers en 0600', { skip: process.platform === 'win32' }, () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'reports'), { mode: 0o755 });
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'approved', 10);
  queue.markAutoSent('crash', 10);
  queue.markManualSent(10);
  const dir = path.join(root, 'reports');
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(dir)) {
    assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600, name);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('supprime les rapports de plus de sept jours', () => {
  const root = tempRoot();
  const logs: string[] = [];
  const queue = new ReportQueue(root, { log: (message) => logs.push(message) });
  queue.enqueue(report('vieux'), 'approved', 1_000);
  queue.enqueue(report('récent'), 'approved', 1_000 + REPORT_TTL_MS);
  assert.equal(REPORT_TTL_MS, 7 * DAY);
  assert.deepEqual(queue.list(undefined, 1_001 + REPORT_TTL_MS).map((item) => item.report.reportId), ['récent']);
  assert.equal(reportFiles(root).length, 1);
  assert.ok(logs.some((line) => line.includes('expiré')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('l’éviction retire d’abord les automatiques non consentis et garde manuels et approuvés', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('manuel', 'manual'), 'approved', 1);
  queue.enqueue(report('attente-1'), 'awaiting-consent', 2);
  queue.enqueue(report('approuvé'), 'approved', 3);
  queue.enqueue(report('attente-2'), 'awaiting-consent', 4);
  assert.deepEqual(queue.list(undefined, 5).map((item) => item.report.reportId), ['manuel', 'approuvé', 'attente-2']);
  queue.enqueue(report('attente-3'), 'awaiting-consent', 6);
  assert.deepEqual(queue.list(undefined, 7).map((item) => item.report.reportId), ['manuel', 'approuvé', 'attente-3']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('les expirés partent avant tout autre rapport', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('expiré', 'manual'), 'approved', 1);
  const later = 2 + REPORT_TTL_MS;
  queue.enqueue(report('attente'), 'awaiting-consent', later);
  queue.enqueue(report('a'), 'approved', later + 1);
  queue.enqueue(report('b'), 'approved', later + 2);
  assert.deepEqual(queue.list(undefined, later + 3).map((item) => item.report.reportId), ['attente', 'a', 'b']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('jamais plus de trois rapports, même sans automatique en attente', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  for (let i = 1; i <= 4; i++) queue.enqueue(report(String(i)), 'approved', i);
  assert.equal(queue.list(undefined, 5).length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('un fichier corrompu est supprimé et journalisé sans planter', () => {
  const root = tempRoot();
  const logs: string[] = [];
  const queue = new ReportQueue(root, { log: (message) => logs.push(message) });
  queue.enqueue(report('sain'), 'approved', 10);
  const broken = path.join(root, 'reports', '5-casse.json.gz');
  fs.writeFileSync(broken, 'pas du gzip');
  fs.writeFileSync(path.join(root, 'reports', 'state.json'), '{pas du json');
  assert.deepEqual(queue.list(undefined, 20).map((item) => item.report.reportId), ['sain']);
  assert.ok(!fs.existsSync(broken));
  assert.ok(logs.some((line) => line.includes('corrompu')));
  assert.equal(queue.mayAutoSend('crash', 20), true, 'un state.json illisible ne bloque rien');
  fs.rmSync(root, { recursive: true, force: true });
});

test('enregistre les envois ratés et la date demandée par Retry-After', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'approved', 10);
  assert.equal(queue.recordFailedDelivery('a', 5_000), 'counted');
  assert.equal(queue.recordFailedDelivery('a', 9_000), 'counted');
  let [item] = new ReportQueue(root).list(undefined, 20);
  assert.equal(item.failedDeliveries, 2);
  assert.equal(item.nextAttemptAt, 9_000);
  queue.recordFailedDelivery('a');
  [item] = new ReportQueue(root).list(undefined, 20);
  assert.equal(item.nextAttemptAt, undefined, 'sans Retry-After, nouvel essai au prochain lancement');
  fs.rmSync(root, { recursive: true, force: true });
});

test('retirer le consentement supprime les approuvés non envoyés seulement', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('attente'), 'awaiting-consent', 1);
  queue.enqueue(report('auto'), 'approved', 2);
  queue.enqueue(report('manuel', 'manual'), 'approved', 3);
  assert.equal(queue.removeApproved(), 2);
  assert.deepEqual(queue.list(undefined, 4).map((item) => item.report.reportId), ['attente']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('applique dix minutes par trigger et persiste le délai', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  assert.equal(queue.mayAutoSend('crash', 1_000), true);
  queue.markAutoSent('crash', 1_000);
  assert.equal(queue.mayAutoSend('crash', 1_000 + 599_999), false);
  assert.equal(new ReportQueue(root).mayAutoSend('crash', 1_000 + 600_000), true);
  assert.equal(queue.mayAutoSend('sync_failed', 1_001), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('limite l’envoi manuel à trois par tranche de dix minutes', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  for (const at of [1_000, 2_000, 3_000]) {
    assert.equal(queue.mayManualSend(at), true);
    queue.markManualSent(at);
  }
  assert.equal(queue.mayManualSend(4_000), false);
  assert.equal(new ReportQueue(root).mayManualSend(1_000 + 600_000), true, 'le plus ancien sort de la fenêtre');
  fs.rmSync(root, { recursive: true, force: true });
});

test('n’évince jamais le rapport qui vient d’être ajouté', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'approved', 10);
  queue.enqueue(report('b'), 'approved', 20);
  queue.enqueue(report('c', 'manual'), 'approved', 30);
  queue.enqueue(report('d'), 'awaiting-consent', 40);
  assert.deepEqual(queue.list(undefined, 50).map((item) => item.report.reportId), ['b', 'c', 'd']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('un envoi manuel daté dans le futur ne bloque pas la limite', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  for (let i = 0; i < 3; i++) queue.markManualSent(10 * DAY);
  assert.equal(queue.mayManualSend(DAY), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('supprime un rapport dont le nom de fichier ne correspond pas au contenu', () => {
  const root = tempRoot();
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'approved', 10);
  const dir = path.join(root, 'reports');
  fs.renameSync(path.join(dir, reportFiles(root)[0]), path.join(dir, 'renomme.json.gz'));
  queue.remove('a');
  assert.deepEqual(reportFiles(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('un rapport en file sans compteur d’échecs part de zéro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-queue-'));
  const dir = path.join(root, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = { state: 'approved', createdAt: 5, report: report('ancien') };
  fs.writeFileSync(path.join(dir, '5-ancien.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(legacy), 'utf8')));
  const queue = new ReportQueue(root);
  for (let failed = 1; failed < MAX_FAILED_DELIVERIES; failed++) {
    assert.equal(queue.recordFailedDelivery('ancien'), 'counted');
    assert.equal(new ReportQueue(root).list()[0].failedDeliveries, failed);
  }
  assert.equal(queue.recordFailedDelivery('ancien'), 'dropped');
  assert.deepEqual(new ReportQueue(root).list(), []);
  assert.equal(queue.recordFailedDelivery('ancien'), 'missing');
  fs.rmSync(root, { recursive: true, force: true });
});

test('un rapport hérité sans date d’expiration reçoit sept jours à sa première lecture', () => {
  const root = tempRoot();
  const dir = path.join(root, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = { state: 'approved', createdAt: 5, report: report('vieux') };
  fs.writeFileSync(path.join(dir, '5-vieux.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(legacy), 'utf8')));
  const before = Date.now();
  const [item] = new ReportQueue(root).list();
  assert.ok(item.expiresAt! >= before + REPORT_TTL_MS, 'la date est posée et enregistrée');
  assert.equal(new ReportQueue(root).list(undefined, item.expiresAt! + 1).length, 0, 'puis il expire comme les autres');
  fs.rmSync(root, { recursive: true, force: true });
});
