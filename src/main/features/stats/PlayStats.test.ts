import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { PlayStats } from './PlayStats.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';
import { cannotMakeFilesInaccessible, makeAccessible, makeInaccessible } from '../../shared/Inaccessible.fixture.ts';

test('stats that cannot be read when a game starts are not reset', { skip: cannotMakeFilesInaccessible }, () => {
  const dir = makeTempDir('karamon-stats-');
  const file = path.join(dir, 'stats.json');
  const original = JSON.stringify({ totalPlayMs: 3_600_000, sessions: 12, lastPlayedAt: 1, firstPlayedAt: 1 });
  fs.writeFileSync(file, original);
  const stats = new PlayStats(file);

  makeInaccessible(file);
  stats.startSession();
  makeAccessible(file);
  stats.endSession();

  assert.deepEqual(fs.readdirSync(dir), ['stats.json']);
  assert.equal(stats.read().sessions, 12);
  assert.equal(stats.read().totalPlayMs, 3_600_000);
});

test('a game session is counted and its time added', () => {
  const dir = makeTempDir('karamon-stats-');
  const stats = new PlayStats(path.join(dir, 'stats.json'));
  stats.startSession();
  const after = stats.endSession();
  assert.equal(after.sessions, 1);
  assert.ok(after.firstPlayedAt !== null);
});
