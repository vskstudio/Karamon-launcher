import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { JsonFile, UnreadableFileError, jsonObject, type UnreadablePolicy } from './DurableFile.ts';
import { makeTempDir } from './TempDir.fixture.ts';

interface Count {
  count: number;
}

function countFile(content: string | null, whenUnreadable: UnreadablePolicy): { file: JsonFile<Count>; dir: string; target: string } {
  const dir = makeTempDir('durable-file-');
  const target = path.join(dir, 'count.json');
  if (content !== null) fs.writeFileSync(target, content);
  const decode = (raw: unknown): Count => {
    const count = jsonObject(raw).count;
    if (typeof count !== 'number') throw new Error('count manquant');
    return { count };
  };
  return { file: new JsonFile(target, decode, { whenUnreadable, indented: false }), dir, target };
}

test('un fichier absent, lisible ou illisible donne trois résultats distincts', () => {
  assert.deepEqual(countFile(null, 'replace').file.read(), { kind: 'missing' });
  assert.deepEqual(countFile('{"count": 3}', 'replace').file.read(), { kind: 'read', value: { count: 3 } });
  assert.equal(countFile('{"count": "trois"}', 'replace').file.read().kind, 'unreadable');
  assert.equal(countFile('{"cou', 'replace').file.read().kind, 'unreadable');
});

test('un fichier illisible est remplacé, mis de côté ou refusé selon la règle choisie', () => {
  const replaced = countFile('{"cou', 'replace');
  assert.deepEqual(replaced.file.write({ count: 1 }), { keptUnreadableAs: null });
  assert.deepEqual(fs.readdirSync(replaced.dir), ['count.json']);

  const setAside = countFile('{"cou', 'set-aside');
  const { keptUnreadableAs } = setAside.file.write({ count: 1 });
  assert.ok(keptUnreadableAs);
  assert.equal(fs.readFileSync(keptUnreadableAs, 'utf8'), '{"cou');
  assert.deepEqual(setAside.file.read(), { kind: 'read', value: { count: 1 } });

  const refused = countFile('{"cou', 'refuse');
  assert.throws(() => refused.file.write({ count: 1 }), UnreadableFileError);
  assert.deepEqual(fs.readdirSync(refused.dir), ['count.json']);
  assert.equal(fs.readFileSync(refused.target, 'utf8'), '{"cou');
});
