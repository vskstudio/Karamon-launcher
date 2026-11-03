import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import https from 'https';
import type { AddressInfo } from 'net';
import tls from 'tls';
import { LOCALHOST_CERT, LOCALHOST_KEY } from './LocalhostCertificate.fixture.ts';
import { SystemCertificates } from './SystemCertificates.ts';

const UNREADABLE_PEM = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
// ISRG Root X2 cross-signed by X1, expired 2025-09-15, still cached in many Windows stores.
const EXPIRED_X2_CROSS_SIGN = `-----BEGIN CERTIFICATE-----
MIIEYDCCAkigAwIBAgIQB55JKIY3b9QISMI/xjHkYzANBgkqhkiG9w0BAQsFADBP
MQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFy
Y2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMTAeFw0yMDA5MDQwMDAwMDBa
Fw0yNTA5MTUxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5l
dCBTZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgy
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0H
ttwW+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7
AlF9ItgKbppbd9/w+kHsOdx1ymgHDB/qo4HlMIHiMA4GA1UdDwEB/wQEAwIBBjAP
BgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR8Qpau3ktIO/qS+J6Mz22LqXI3lTAf
BgNVHSMEGDAWgBR5tFnme7bl5AFzgAiIyBpY9umbbjAyBggrBgEFBQcBAQQmMCQw
IgYIKwYBBQUHMAKGFmh0dHA6Ly94MS5pLmxlbmNyLm9yZy8wJwYDVR0fBCAwHjAc
oBqgGIYWaHR0cDovL3gxLmMubGVuY3Iub3JnLzAiBgNVHSAEGzAZMAgGBmeBDAEC
ATANBgsrBgEEAYLfEwEBATANBgkqhkiG9w0BAQsFAAOCAgEAG38lK5B6CHYAdxjh
wy6KNkxBfr8XS+Mw11sMfpyWmG97sGjAJETM4vL80erb0p8B+RdNDJ1V/aWtbdIv
P0tywC6uc8clFlfCPhWt4DHRCoSEbGJ4QjEiRhrtekC/lxaBRHfKbHtdIVwH8hGR
Ib/hL8Lvbv0FIOS093nzLbs3KvDGsaysUfUfs1oeZs5YBxg4f3GpPIO617yCnpp2
D56wKf3L84kHSBv+q5MuFCENX6+Ot1SrXQ7UW0xx0JLqPaM2m3wf4DtVudhTU8yD
ZrtK3IEGABiL9LPXSLETQbnEtp7PLHeOQiALgH6fxatI27xvBI1sRikCDXCKHfES
c7ZGJEKeKhcY46zHmMJyzG0tdm3dLCsmlqXPIQgb5dovy++fc5Ou+DZfR4+XKM6r
4pgmmIv97igyIintTJUJxCD6B+GGLET2gUfA5GIy7R3YPEiIlsNekbave1mk7uOG
nMeIWMooKmZVm4WAuR3YQCvJHBM8qevemcIWQPb1pK4qJWxSuscETLQyu/w4XKAM
YXtX7HdOUM+vBqIPN4zhDtLTLxq9nHE+zOH40aijvQT2GcD5hq/1DhqqlWvvykdx
S2McTZbbVSMKnQ+BdaDmQPVkRgNuzvpqfQbspDQGdNpT2Lm4xiN9qfgqLaSCpi4t
EcrmzTFYeYXmchynn9NM0GbQp7s=
-----END CERTIFICATE-----`;
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

  assert.deepEqual(report, { added: 1, rejected: 0, expired: 0 });
  assert.equal(await fetchFromLocalhost(), 'status 200');
});

test('les racines déjà connues de Node ne sont pas comptées deux fois', () => {
  systemStoreHolding([bundledCertificates[0], LOCALHOST_CERT]);

  assert.deepEqual(SystemCertificates.trust(), { added: 1, rejected: 0, expired: 0 });
});

test('un certificat illisible du système est ignoré sans perdre les autres', async () => {
  systemStoreHolding([UNREADABLE_PEM, LOCALHOST_CERT]);

  const report = SystemCertificates.trust();

  assert.deepEqual(report, { added: 1, rejected: 1, expired: 0 });
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

  assert.deepEqual(report, { added: 0, rejected: 0, expired: 0, failure: unreadableStore });
  assert.equal(setDefault.mock.callCount(), 0);
  assert.match(await fetchFromLocalhost(), /^error /);
});

test('un certificat expiré du système est ignoré', async () => {
  systemStoreHolding([EXPIRED_X2_CROSS_SIGN, LOCALHOST_CERT]);

  const report = SystemCertificates.trust();

  assert.deepEqual(report, { added: 1, rejected: 0, expired: 1 });
  assert.equal(await fetchFromLocalhost(), 'status 200');
  assert.match(SystemCertificates.describe(report), /1 expiré\(s\) ignoré\(s\)/);
});
