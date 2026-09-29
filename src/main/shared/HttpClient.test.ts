import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { HttpClient, parseTotalSize, planByteRanges } from './HttpClient.ts';

const LOCALHOST_CERT = `-----BEGIN CERTIFICATE-----
MIIBkTCCATagAwIBAgIUT+X+nHW/rnj1r6XZ1C8/5Vv1iukwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MDkyOTE1NDUwM1oYDzIxMjYwOTA1
MTU0NTAzWjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAR//kDva7CsuYOTF2zWPxgNGANZiBdH5vI3SZb05KqKbFEWASTachDF
S+JU6Is4KyAFH9MR7oGqScDUZrsur+bso2QwYjAdBgNVHQ4EFgQUZcmNqoZ1rcNQ
8+zb7uRsvPw1zXcwHwYDVR0jBBgwFoAUZcmNqoZ1rcNQ8+zb7uRsvPw1zXcwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0kAMEYC
IQCCvYjtbgXMZ+rdE2PvEAld/na1/Ax3mRpK4m65abtR2AIhAPis6NEMJb+lMsC7
tbyj85TqyHjuERB7WxJtLSMADvA0
-----END CERTIFICATE-----`;
const LOCALHOST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgn7tOSTVIns+WXqHo
Wm7AE4KAxB9YLPGjm4hPXamngLihRANCAAR//kDva7CsuYOTF2zWPxgNGANZiBdH
5vI3SZb05KqKbFEWASTachDFS+JU6Is4KyAFH9MR7oGqScDUZrsur+bs
-----END PRIVATE KEY-----`;
const SERVED_BODY = Buffer.from('karamon runtime archive');

async function withServedFile(run: (url: string, dest: string) => Promise<void>): Promise<void> {
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), LOCALHOST_CERT]);
  const server = https.createServer({ cert: LOCALHOST_CERT, key: LOCALHOST_KEY }, (_req, res) => {
    res.writeHead(200, { 'Content-Length': SERVED_BODY.length });
    res.end(SERVED_BODY);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-http-'));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`https://127.0.0.1:${port}/jre.tar.gz`, path.join(dir, 'jre.tar.gz'));
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('download keeps a file whose SHA256 matches', async () => {
  const sha256 = crypto.createHash('sha256').update(SERVED_BODY).digest('hex');
  await withServedFile(async (url, dest) => {
    await new HttpClient().download(url, dest, { expectedSha256: sha256.toUpperCase() });
    assert.deepEqual(fs.readFileSync(dest), SERVED_BODY);
  });
});

test('download refuses and deletes a file whose SHA256 does not match', async () => {
  const tampered = crypto.createHash('sha256').update('another archive').digest('hex');
  await withServedFile(async (url, dest) => {
    await assert.rejects(
      new HttpClient().download(url, dest, { expectedSha256: tampered, label: 'Java 21' }),
      new RegExp(`^Error: SHA256 mismatch for Java 21: expected ${tampered}, got `),
    );
    assert.equal(fs.existsSync(dest), false);
  });
});

test('download refuses and deletes a file whose SHA1 does not match', async () => {
  const tampered = crypto.createHash('sha1').update('another library').digest('hex');
  await withServedFile(async (url, dest) => {
    await assert.rejects(new HttpClient().download(url, dest, { expectedSha1: tampered }), /SHA1 mismatch/);
    assert.equal(fs.existsSync(dest), false);
  });
});

test('planByteRanges splits a file into contiguous byte ranges', () => {
  assert.deepEqual(planByteRanges(1000, 4), [
    { start: 0, end: 249 },
    { start: 250, end: 499 },
    { start: 500, end: 749 },
    { start: 750, end: 999 },
  ]);
});

test('planByteRanges keeps the remainder on the last part', () => {
  assert.deepEqual(planByteRanges(10, 3), [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 9 },
  ]);
});

test('planByteRanges does not invent empty ranges', () => {
  assert.deepEqual(planByteRanges(2, 8), [
    { start: 0, end: 0 },
    { start: 1, end: 1 },
  ]);
  assert.deepEqual(planByteRanges(0, 8), []);
});

test('parseTotalSize reads Content-Range from a 206 probe', () => {
  assert.equal(parseTotalSize({ 'content-range': 'bytes 0-0/378064364' }, 206), 378064364);
  assert.equal(parseTotalSize({ 'content-length': '123' }, 200), 123);
  assert.equal(parseTotalSize({}, 206), 0);
});
