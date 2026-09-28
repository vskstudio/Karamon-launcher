import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ServersDat } from './ServersDat.ts';

function listed(dir: string): string {
  return fs.readFileSync(path.join(dir, 'servers.dat')).toString('latin1');
}

test('the old playit tunnel entry is replaced by play.karamon.fr', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servers-dat-'));
  new ServersDat(dir).ensureServer('expressing-marx.tun.ply.gg', 'Karamon', true);
  assert.ok(listed(dir).includes('expressing-marx.tun.ply.gg'));

  new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon');
  assert.ok(listed(dir).includes('play.karamon.fr'));
  assert.ok(!listed(dir).includes('ply.gg'));
});

test("a player's own servers are kept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servers-dat-'));
  new ServersDat(dir).ensureServer('mc.example.org', 'Other', true);
  new ServersDat(dir).ensureServer('play.karamon.fr', 'Karamon');
  assert.ok(listed(dir).includes('mc.example.org'));
});
