import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { MAX_FAILED_DELIVERIES, ReportQueue } from './ReportQueue.ts';
import type { LauncherReport } from './ReportTypes.ts';

function report(id: string): LauncherReport {
  return {
    reportId: id,
    launcherVersion: '2.1.0',
    packVersion: '0.9.5',
    os: 'linux',
    arch: 'x64',
    javaVersion: '21',
    ramMb: 8192,
    trigger: 'crash',
    summary: [`crash ${id}`],
    files: [],
  };
}

test('persiste des rapports gzip et leurs états entre deux instances', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-queue-'));
  const queue = new ReportQueue(root);
  queue.enqueue(report('a'), 'awaiting-consent', 10);
  queue.enqueue(report('b'), 'approved', 20);

  const restored = new ReportQueue(root);
  assert.deepEqual(restored.list().map((item) => [item.report.reportId, item.state]), [
    ['a', 'awaiting-consent'],
    ['b', 'approved'],
  ]);
  assert.deepEqual(restored.list('approved').map((item) => item.report.reportId), ['b']);
  assert.ok(fs.readdirSync(path.join(root, 'reports')).every((name) => name.endsWith('.json.gz')));
  assert.ok(!fs.readdirSync(path.join(root, 'reports')).some((name) => name.includes('karamon-tmp')));

  restored.approve('a');
  assert.equal(new ReportQueue(root).list()[0].state, 'approved');
  restored.remove('b');
  assert.deepEqual(new ReportQueue(root).list().map((item) => item.report.reportId), ['a']);
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
    assert.equal(queue.recordFailedDelivery('ancien'), true);
    assert.equal(new ReportQueue(root).list()[0].failedDeliveries, failed);
  }
  assert.equal(queue.recordFailedDelivery('ancien'), false);
  assert.deepEqual(new ReportQueue(root).list(), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ne garde que les trois rapports les plus récents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-queue-'));
  const queue = new ReportQueue(root);
  for (let i = 1; i <= 4; i++) queue.enqueue(report(String(i)), 'approved', i);
  assert.deepEqual(queue.list().map((item) => item.report.reportId), ['2', '3', '4']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('applique dix minutes par trigger et persiste le délai', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-queue-'));
  const queue = new ReportQueue(root);
  assert.equal(queue.mayAutoSend('crash', 1_000), true);
  queue.markAutoSent('crash', 1_000);
  assert.equal(queue.mayAutoSend('crash', 1_000 + 599_999), false);
  assert.equal(new ReportQueue(root).mayAutoSend('crash', 1_000 + 600_000), true);
  assert.equal(queue.mayAutoSend('sync_failed', 1_001), true);
  assert.equal(queue.mayAutoSend('manual', 1_001), true);
  fs.rmSync(root, { recursive: true, force: true });
});
