import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ServersDat } from './ServersDat.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';

function tempDir(): string {
  return makeTempDir('servers-dat-');
}

function listed(dir: string): string {
  return fs.readFileSync(path.join(dir, 'servers.dat')).toString('latin1');
}

function nbtString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function namedTag(type: number, key: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), nbtString(key), payload]);
}

function vanillaServersDat(servers: Array<{ ip: string; name: string; icon?: string }>): Buffer {
  const entries = servers.map((s) =>
    Buffer.concat([
      namedTag(8, 'ip', nbtString(s.ip)),
      namedTag(8, 'name', nbtString(s.name)),
      ...(s.icon ? [namedTag(8, 'icon', nbtString(s.icon))] : []),
      namedTag(1, 'hidden', Buffer.from([0])),
      Buffer.from([0]),
    ]),
  );
  const count = Buffer.alloc(4);
  count.writeInt32BE(entries.length);
  const list = namedTag(9, 'servers', Buffer.concat([Buffer.from([10]), count, ...entries]));
  return Buffer.concat([Buffer.from([10, 0, 0]), list, Buffer.from([0])]);
}

test('the old playit tunnel entry is replaced by play.karamon.fr', () => {
  const dir = tempDir();
  new ServersDat(dir).ensureServer('expressing-marx.tun.ply.gg', 'Karamon', true);
  assert.ok(listed(dir).includes('expressing-marx.tun.ply.gg'));

  new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon');
  assert.ok(listed(dir).includes('play.karamon.fr'));
  assert.ok(!listed(dir).includes('ply.gg'));
});

test("a player's own servers are kept with the fields Karamon does not know", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'servers.dat'), vanillaServersDat([{ ip: 'mc.example.org', name: 'Other', icon: 'iVBORw0KGgo' }]));
  new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon');
  assert.ok(listed(dir).includes('mc.example.org'));
  assert.ok(listed(dir).includes('iVBORw0KGgo'));
  assert.ok(listed(dir).includes('play.karamon.fr'));
});

test("outside dev mode the player's localhost server stays, only the Karamon dev entry goes", () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'servers.dat'),
    vanillaServersDat([
      { ip: 'localhost:25570', name: 'Mon serveur de test' },
      { ip: 'localhost', name: ServersDat.devServerName('Karamon') },
    ]),
  );
  new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon');
  assert.ok(listed(dir).includes('Mon serveur de test'));
  assert.ok(!listed(dir).includes(ServersDat.devServerName('Karamon')));
});

test('a servers.dat Karamon cannot read is left untouched', () => {
  const dir = tempDir();
  const file = path.join(dir, 'servers.dat');
  const truncated = vanillaServersDat([{ ip: 'mc.example.org', name: 'Other' }]).subarray(0, 20);
  fs.writeFileSync(file, truncated);
  assert.throws(() => new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon'), /illisible/);
  assert.deepEqual(fs.readFileSync(file), truncated);
});
