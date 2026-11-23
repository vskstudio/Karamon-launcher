import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import {
  DigestMismatchError,
  HttpClient,
  HttpStatusError,
  InsecureUrlError,
  ResourceChangedError,
  TimeoutError,
} from './HttpClient.ts';
import { LOCALHOST_CERT, LOCALHOST_KEY } from './LocalhostCertificate.fixture.ts';

const SERVED_BODY = Buffer.from('karamon runtime archive');

type Handler = (req: IncomingMessage, res: ServerResponse, origin: string) => void;

async function withServer(handler: Handler, run: (origin: string, dir: string) => Promise<void>): Promise<void> {
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), LOCALHOST_CERT]);
  let origin = '';
  const server = https.createServer({ cert: LOCALHOST_CERT, key: LOCALHOST_KEY }, (req, res) => handler(req, res, origin));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-http-'));
  try {
    await run(origin, dir);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const servingBody: Handler = (_req, res) => {
  res.writeHead(200, { 'Content-Length': SERVED_BODY.length });
  res.end(SERVED_BODY);
};

function rangedFile(current: () => { body: Buffer; etag: string }): Handler {
  return (req, res) => {
    const { body, etag } = current();
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const ifRange = req.headers['if-range'];
    if (!range || (ifRange && ifRange !== etag)) {
      res.writeHead(200, { 'Content-Length': body.length, ETag: etag });
      res.end(body);
      return;
    }
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), body.length - 1);
    res.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${body.length}`,
      ETag: etag,
    });
    res.end(body.subarray(start, end + 1));
  };
}

test('download keeps a file whose SHA256 matches', async () => {
  const sha256 = crypto.createHash('sha256').update(SERVED_BODY).digest('hex');
  await withServer(servingBody, async (origin, dir) => {
    const dest = path.join(dir, 'jre.tar.gz');
    await new HttpClient().download(`${origin}/jre.tar.gz`, dest, { expectedSha256: sha256.toUpperCase() });
    assert.deepEqual(fs.readFileSync(dest), SERVED_BODY);
  });
});

test('download refuses and leaves no file when the SHA256 or SHA1 does not match', async () => {
  const tamperedSha256 = crypto.createHash('sha256').update('another archive').digest('hex');
  const tamperedSha1 = crypto.createHash('sha1').update('another library').digest('hex');
  await withServer(servingBody, async (origin, dir) => {
    const dest = path.join(dir, 'jre.tar.gz');
    await assert.rejects(
      new HttpClient().download(`${origin}/jre.tar.gz`, dest, { expectedSha256: tamperedSha256, label: 'Java 21' }),
      (e: Error) => e instanceof DigestMismatchError && e.message.startsWith(`SHA256 mismatch for Java 21: expected ${tamperedSha256}, got `),
    );
    await assert.rejects(new HttpClient().download(`${origin}/lib.jar`, dest, { expectedSha1: tamperedSha1 }), DigestMismatchError);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('a large file is fetched in ranges and assembled byte for byte', async () => {
  const body = crypto.randomBytes(9 * 1024 * 1024);
  const seenIfRange = new Set<string | undefined>();
  const serve = rangedFile(() => ({ body, etag: '"v1"' }));
  await withServer(
    (req, res, origin) => {
      if (req.headers.range !== 'bytes=0-0') seenIfRange.add(req.headers['if-range']);
      serve(req, res, origin);
    },
    async (origin, dir) => {
      const dest = path.join(dir, 'mods.zip');
      await new HttpClient().download(`${origin}/mods.zip`, dest, { label: 'mods.zip' });
      assert.ok(fs.readFileSync(dest).equals(body));
      assert.deepEqual([...seenIfRange], ['"v1"']);
    },
  );
});

test('a large file republished during a ranged download fails instead of mixing both versions', async () => {
  const oldBody = Buffer.alloc(9 * 1024 * 1024, 1);
  const newBody = Buffer.alloc(9 * 1024 * 1024, 2);
  let probes = 0;
  const serve = rangedFile(() => (probes === 0 ? { body: oldBody, etag: '"v1"' } : { body: newBody, etag: '"v2"' }));
  await withServer(
    (req, res, origin) => {
      serve(req, res, origin);
      if (req.headers.range === 'bytes=0-0') probes++;
    },
    async (origin, dir) => {
      const dest = path.join(dir, 'mods.zip');
      await assert.rejects(new HttpClient().download(`${origin}/mods.zip`, dest, { label: 'mods.zip' }), ResourceChangedError);
      assert.deepEqual(fs.readdirSync(dir), []);
    },
  );
});

test('redirects are followed over HTTPS only', async () => {
  await withServer(
    (req, res, origin) => {
      if (req.url === '/moved') {
        res.writeHead(302, { Location: `${origin}/pack.json` });
        res.end();
      } else if (req.url === '/downgrade') {
        res.writeHead(301, { Location: origin.replace('https:', 'http:') + '/pack.json' });
        res.end();
      } else {
        res.writeHead(200);
        res.end('{"version":"0.5.2"}');
      }
    },
    async (origin) => {
      const http = new HttpClient();
      assert.deepEqual(await http.getJson(`${origin}/moved`), { version: '0.5.2' });
      await assert.rejects(http.getText(`${origin}/downgrade`), InsecureUrlError);
    },
  );
});

test('an error status is an HttpStatusError carrying the status', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404);
      res.end();
    },
    async (origin) => {
      await assert.rejects(new HttpClient().getText(`${origin}/absent`), (e: Error) => e instanceof HttpStatusError && e.status === 404);
    },
  );
});

test('the idle timeout fires when bytes stop coming, the total timeout when they trickle forever', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200);
      res.write('a');
      if (req.url === '/trickle') {
        const timer = setInterval(() => res.write('a'), 20);
        res.on('close', () => clearInterval(timer));
      }
    },
    async (origin) => {
      const http = new HttpClient();
      await assert.rejects(http.get(`${origin}/stalled`, { idleTimeoutMs: 100 }), (e: Error) => e instanceof TimeoutError && e.kind === 'idle');
      await assert.rejects(
        http.get(`${origin}/trickle`, { idleTimeoutMs: 1000, totalTimeoutMs: 200 }),
        (e: Error) => e instanceof TimeoutError && e.kind === 'total',
      );
    },
  );
});

test('requests carry the launcher version in their User-Agent', async () => {
  let userAgent: string | undefined;
  await withServer(
    (req, res) => {
      userAgent = req.headers['user-agent'];
      res.end();
    },
    async (origin) => {
      await new HttpClient({ appVersion: '2.1.0' }).get(`${origin}/`);
      assert.equal(userAgent, 'KaramonLauncher/2.1.0');
    },
  );
});

test('postJson sends the JSON body with its UTF-8 length and returns error statuses without throwing', async () => {
  const received: { method?: string; type?: string; body?: string }[] = [];
  await withServer(
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({ method: req.method, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end('{"error":"player_changed"}');
      });
    },
    async (origin) => {
      const response = await new HttpClient().postJson(`${origin}/api/shop/checkout`, { username: 'Élodie', accept_terms: true });
      assert.equal(response.status, 409);
      assert.equal(response.body.toString('utf8'), '{"error":"player_changed"}');
      assert.deepEqual(received, [{ method: 'POST', type: 'application/json', body: '{"username":"Élodie","accept_terms":true}' }]);
    },
  );
});
