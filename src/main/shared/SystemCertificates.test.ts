import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import https from 'https';
import type { AddressInfo } from 'net';
import tls from 'tls';
import { LOCALHOST_CERT, LOCALHOST_KEY } from './LocalhostCertificate.fixture.ts';
import { SystemCertificates } from './SystemCertificates.ts';

const UNREADABLE_PEM = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
const bundledCertificates = tls.getCACertificates('bundled');
const realGetCACertificates = tls.getCACertificates;

function systemStoreHolding(certificates: string[]): void {
  mock.method(tls, 'getCACertificates', (store?: tls.CertificateStore) =>
    store === 'system' ? certificates : realGetCACertificates(store),
  );
}

async function fetchFromLocalhost(): Promise<string> {
  const server = https.createServer({ cert: LOCALHOST_CERT, key: LOCALHOST_KEY }, (_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<string>((resolve) => {
      https
        .get(`https://127.0.0.1:${port}/`, { agent: new https.Agent() }, (res) => {
          res.resume();
          resolve(`status ${res.statusCode}`);
        })
        .on('error', (error: NodeJS.ErrnoException) => resolve(`error ${error.code}`));
    });
  } finally {
    server.close();
  }
}

afterEach(() => {
  mock.restoreAll();
  tls.setDefaultCACertificates(bundledCertificates);
});

test('une racine installée dans le système rend son certificat accepté par https', async () => {
  systemStoreHolding([LOCALHOST_CERT]);
  assert.match(await fetchFromLocalhost(), /^error /);

  const report = SystemCertificates.trust();

  assert.deepEqual(report, { added: 1, rejected: 0 });
  assert.equal(await fetchFromLocalhost(), 'status 200');
});

test('les racines déjà connues de Node ne sont pas comptées deux fois', () => {
  systemStoreHolding([bundledCertificates[0], LOCALHOST_CERT]);

  assert.deepEqual(SystemCertificates.trust(), { added: 1, rejected: 0 });
});

test('un certificat illisible du système est ignoré sans perdre les autres', async () => {
  systemStoreHolding([UNREADABLE_PEM, LOCALHOST_CERT]);

  const report = SystemCertificates.trust();

  assert.deepEqual(report, { added: 1, rejected: 1 });
  assert.equal(await fetchFromLocalhost(), 'status 200');
  assert.match(SystemCertificates.describe(report), /1 ajouté\(s\), 1 illisible\(s\) ignoré\(s\)/);
});

test('un magasin système illisible laisse les certificats de Node en place', async () => {
  const unreadableStore = new Error('magasin verrouillé');
  mock.method(tls, 'getCACertificates', (store?: tls.CertificateStore) => {
    if (store === 'system') throw unreadableStore;
    return realGetCACertificates(store);
  });
  const setDefault = mock.method(tls, 'setDefaultCACertificates');

  const report = SystemCertificates.trust();

  assert.deepEqual(report, { added: 0, rejected: 0, failure: unreadableStore });
  assert.equal(setDefault.mock.callCount(), 0);
  assert.match(await fetchFromLocalhost(), /^error /);
});
