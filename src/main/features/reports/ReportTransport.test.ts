import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'zlib';
import { ReportTransport } from './ReportTransport.ts';
import type { HttpClient, RequestOptions } from '../../shared/HttpClient.ts';
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

test('poste le JSON gzip avec les en-têtes du contrat vers la route des rapports du panel', async () => {
  let seen: { url: string; body: Buffer; headers: Record<string, string> } | undefined;
  const http: Pick<HttpClient, 'post'> = {
    async post(url, body, options: RequestOptions = {}) {
      seen = { url, body: body as Buffer, headers: options.headers ?? {} };
      return { status: 201, body: Buffer.alloc(0) };
    },
  };
  const result = await new ReportTransport(http).send(report);
  assert.equal(result, 'sent');
  assert.equal(seen?.url, 'https://karamon.fr/panel/api/launcher/reports');
  assert.equal(seen?.headers['Content-Type'], 'application/json');
  assert.equal(seen?.headers['Content-Encoding'], 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(seen!.body).toString('utf8')), report);
});

test('classe les réponses pour la file de réessai', async () => {
  for (const [status, expected] of [[200, 'sent'], [204, 'sent'], [400, 'discard'], [404, 'discard'], [408, 'retry'], [413, 'discard'], [429, 'retry'], [500, 'retry'], [503, 'retry']] as const) {
    const transport = new ReportTransport({ post: async () => ({ status, body: Buffer.alloc(0) }) });
    assert.equal(await transport.send(report), expected, `HTTP ${status}`);
  }
  const offline = new ReportTransport({ post: async () => { throw new Error('offline'); } });
  assert.equal(await offline.send(report), 'retry');
});
