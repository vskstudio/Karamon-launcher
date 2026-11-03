import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'zlib';
import { LAUNCHER_REPORTS_URL, ReportTransport, type ReportPost, type ReportPostResponse } from './ReportTransport.ts';
import type { LauncherReport } from './ReportTypes.ts';

const report: LauncherReport = {
  reportId: '123e4567-e89b-42d3-a456-426614174000',
  launcherVersion: '2.1.0',
  packVersion: '0.9.5',
  os: 'linux',
  arch: 'x64',
  javaVersion: '21',
  ramMb: 8192,
  trigger: 'manual',
  summary: ['test'],
  files: [{ name: 'launcher.log', content: 'bonjour' }],
};

function reply(status: number, extra: Partial<ReportPostResponse> = {}): ReportPost {
  return async () => ({ status, headers: {}, body: '', ...extra });
}

test('poste le JSON gzip avec les en-têtes du contrat vers la constante unique', async () => {
  let seen: { url: string; body: Buffer; headers: Record<string, string>; signal: AbortSignal } | undefined;
  const post: ReportPost = async (url, body, headers, signal) => {
    seen = { url, body, headers, signal };
    return { status: 201, headers: {}, body: JSON.stringify({ id: report.reportId }) };
  };
  const result = await new ReportTransport({ post }).send(report);
  assert.deepEqual(result, { kind: 'sent', serverId: report.reportId });
  assert.equal(seen?.url, LAUNCHER_REPORTS_URL);
  assert.equal(LAUNCHER_REPORTS_URL, 'https://karamon.fr/panel/api/launcher/reports');
  assert.equal(seen?.headers['Content-Type'], 'application/json');
  assert.equal(seen?.headers['Content-Encoding'], 'gzip');
  assert.equal(seen?.headers['Idempotency-Key'], report.reportId);
  assert.ok(seen?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(seen!.body).toString('utf8')), report);
});

test('l’identifiant vient du serveur : réponse sans id = envoyé sans code', async () => {
  assert.deepEqual(await new ReportTransport({ post: reply(201, { body: 'ok' }) }).send(report), { kind: 'sent', serverId: null });
  assert.deepEqual(
    await new ReportTransport({ post: reply(201, { body: JSON.stringify({ id: '<script>' }) }) }).send(report),
    { kind: 'sent', serverId: null },
  );
});

test('classe les réponses pour la file de réessai', async () => {
  const cases = [
    [200, 'sent'], [204, 'sent'],
    [400, 'discard'], [401, 'discard'], [403, 'discard'], [404, 'discard'], [413, 'discard'],
    [408, 'retry'], [429, 'retry'], [500, 'retry'], [503, 'retry'],
  ] as const;
  for (const [status, expected] of cases) {
    const result = await new ReportTransport({ post: reply(status) }).send(report);
    assert.equal(result.kind, expected, `HTTP ${status}`);
  }
  const offline = await new ReportTransport({ post: async () => { throw new Error('offline'); } }).send(report);
  assert.equal(offline.kind, 'retry');
});

test('respecte Retry-After en secondes ou en date HTTP', async () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  const seconds = await new ReportTransport({ post: reply(429, { headers: { 'retry-after': '120' } }), now: () => now }).send(report);
  assert.deepEqual(seconds, { kind: 'retry', reason: 'HTTP 429', retryAfterMs: 120_000 });
  const date = await new ReportTransport({
    post: reply(503, { headers: { 'retry-after': 'Sat, 17 Oct 2026 10:05:00 GMT' } }),
    now: () => now,
  }).send(report);
  assert.deepEqual(date, { kind: 'retry', reason: 'HTTP 503', retryAfterMs: 300_000 });
  const junk = await new ReportTransport({ post: reply(503, { headers: { 'retry-after': 'bientôt' } }) }).send(report);
  assert.equal(junk.kind === 'retry' && junk.retryAfterMs, null);
});

test('coupe la requête au délai via AbortController', async () => {
  const post: ReportPost = (_url, _body, _headers, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const result = await new ReportTransport({ post, timeoutMs: 20 }).send(report);
  assert.deepEqual(result, { kind: 'retry', reason: 'délai dépassé', retryAfterMs: null });
});

test('un rapport trop gros n’est jamais posté', async () => {
  let posted = false;
  const huge = { ...report, files: [{ name: 'latest.log', content: 'x'.repeat(6 * 1024 * 1024) }] };
  const result = await new ReportTransport({ post: async () => { posted = true; return { status: 201, headers: {}, body: '' }; } }).send(huge);
  assert.equal(result.kind, 'discard');
  assert.equal(posted, false);
});
