import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import { RemoteZip } from './RemoteZip.ts';
import { RangeUnsupportedError, type HttpClient, type RangeRequest } from './HttpClient.ts';

/** In-memory server for one file, counting what it sends. */
function fakeServer(file: () => Buffer, etag: () => string) {
  const stats = { requests: 0, bytes: 0 };
  const slice = (range: RangeRequest) => {
    const body = file();
    if (range.ifRange && range.ifRange !== etag()) throw new RangeUnsupportedError('HTTP 200 (fichier changé)');
    const start = range.end === undefined && range.start < 0 ? Math.max(0, body.length + range.start) : range.start;
    const end = range.end === undefined ? body.length - 1 : Math.min(range.end, body.length - 1);
    stats.requests++;
    stats.bytes += end - start + 1;
    return { data: body.subarray(start, end + 1), start, end, total: body.length };
  };
  const http = {
    async getRange(_url: string, range: RangeRequest) {
      const s = slice(range);
      return { body: Buffer.from(s.data), start: s.start, total: s.total, etag: etag() };
    },
    async openRange(_url: string, range: RangeRequest) {
      const s = slice(range);
      const stream = new PassThrough();
      // Small chunks, to cut local headers in the middle.
      for (let i = 0; i < s.data.length; i += 7) stream.write(s.data.subarray(i, i + 7));
      stream.end();
      return { stream, start: s.start, end: s.end, total: s.total, etag: etag() };
    },
  } as unknown as HttpClient;
  return { http, stats };
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remotezip-'));
}

const BIG = crypto.randomBytes(300_000);

function bigBytes(): Buffer {
  return BIG;
}

function packZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('mods/a.jar', bigBytes());
  zip.addFile('mods/b.jar', Buffer.from('petit jar b'));
  zip.addFile('mods/stocke.bin', Buffer.from('stocke'), '', 0);
  zip.getEntry('mods/stocke.bin')!.header.method = 0;
  zip.addFile('mods/vide.txt', Buffer.alloc(0));
  return zip.toBuffer();
}

test('liste les entrées et n extrait que celles demandées, sans télécharger le reste', async () => {
  const body = packZip();
  const { http, stats } = fakeServer(() => body, () => '"v1"');
  const zip = await RemoteZip.open(http, 'https://x/pack.zip');
  assert.deepEqual(zip.entries.map((e) => e.entryName).sort(), ['mods/a.jar', 'mods/b.jar', 'mods/stocke.bin', 'mods/vide.txt']);
  const openBytes = stats.bytes;
  assert.ok(openBytes < 70_000, `ouverture: ${openBytes} octets`);

  const dir = tmp();
  const wanted = zip.entries.filter((e) => e.entryName !== 'mods/a.jar');
  for (const entry of wanted) await zip.extractTo(entry, path.join(dir, entry.entryName));
  assert.equal(fs.readFileSync(path.join(dir, 'mods', 'b.jar'), 'utf8'), 'petit jar b');
  assert.equal(fs.readFileSync(path.join(dir, 'mods', 'stocke.bin'), 'utf8'), 'stocke');
  assert.equal(fs.readFileSync(path.join(dir, 'mods', 'vide.txt')).length, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'mods', 'a.jar')));
  assert.equal(stats.bytes - openBytes, zip.bytesFor(wanted));
  assert.ok(stats.bytes < body.length, 'moins que l archive entière');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extrait une grosse entrée compressée à l identique', async () => {
  const body = packZip();
  const { http } = fakeServer(() => body, () => '"v1"');
  const zip = await RemoteZip.open(http, 'https://x/pack.zip');
  const dir = tmp();
  const entry = zip.entries.find((e) => e.entryName === 'mods/a.jar')!;
  let counted = 0;
  await zip.extractTo(entry, path.join(dir, 'a.jar'), { durable: true, onBytes: (n) => (counted += n) });
  assert.ok(fs.readFileSync(path.join(dir, 'a.jar')).equals(bigBytes()));
  assert.equal(counted, zip.bytesFor([entry]));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuse de mélanger deux versions si l archive est republiée en cours de route', async () => {
  let body = packZip();
  let etag = '"v1"';
  const { http } = fakeServer(() => body, () => etag);
  const zip = await RemoteZip.open(http, 'https://x/pack.zip');
  const other = new AdmZip();
  other.addFile('mods/b.jar', Buffer.from('autre version'));
  body = other.toBuffer();
  etag = '"v2"';
  const dir = tmp();
  const target = path.join(dir, 'b.jar');
  fs.writeFileSync(target, 'ancien');
  await assert.rejects(
    zip.extractTo(zip.entries.find((e) => e.entryName === 'mods/b.jar')!, target),
    (e: Error) => e.name === 'RangeUnsupportedError',
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'ancien');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lit le répertoire central quand il ne tient pas dans la fin de fichier', async () => {
  const zip = new AdmZip();
  for (let i = 0; i < 1500; i++) zip.addFile(`config/fichier-avec-un-nom-assez-long-${i}.json`, Buffer.from(`{"i":${i}}`));
  const body = zip.toBuffer();
  const { http, stats } = fakeServer(() => body, () => '"v1"');
  const remote = await RemoteZip.open(http, 'https://x/big.zip');
  assert.equal(remote.entries.length, 1500);
  assert.equal(stats.requests, 2);
  const dir = tmp();
  const e = remote.entries.find((x) => x.entryName.endsWith('-1499.json'))!;
  await remote.extractTo(e, path.join(dir, 'f.json'));
  assert.equal(fs.readFileSync(path.join(dir, 'f.json'), 'utf8'), '{"i":1499}');
  fs.rmSync(dir, { recursive: true, force: true });
});
