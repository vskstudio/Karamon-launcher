import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { JsonFile, UnreadableFileError, jsonObject, type UnreadablePolicy } from './DurableFile.ts';
import { makeTempDir } from './TempDir.fixture.ts';
import { cannotMakeFilesInaccessible, makeAccessible, makeInaccessible } from './Inaccessible.fixture.ts';

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

test('une erreur de lecture se distingue d’un contenu invalide', { skip: cannotMakeFilesInaccessible }, () => {
  const { file, target } = countFile('{"count": 3}', 'set-aside');
  makeInaccessible(target);
  const state = file.read();
  makeAccessible(target);
  assert.equal(state.kind === 'unreadable' && state.cause, 'io');
  const invalid = countFile('{"cou', 'set-aside').file.read();
  assert.equal(invalid.kind === 'unreadable' && invalid.cause, 'content');
});

test('un fichier qu’on ne peut pas lire n’est jamais écrasé', { skip: cannotMakeFilesInaccessible }, () => {
  const { file, dir, target } = countFile('{"count": 3}', 'set-aside');
  makeInaccessible(target);
  assert.throws(() => file.write({ count: 1 }), UnreadableFileError);
  makeAccessible(target);
  assert.deepEqual(fs.readdirSync(dir), ['count.json']);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"count": 3}');
});

test('un fichier vu illisible puis redevenu lisible avant l’écriture est mis de côté', { skip: cannotMakeFilesInaccessible }, () => {
  const { file, target } = countFile('{"count": 3}', 'set-aside');
  makeInaccessible(target);
  file.read();
  makeAccessible(target);
  const { keptUnreadableAs } = file.write({ count: 1 });
  assert.ok(keptUnreadableAs);
  assert.equal(fs.readFileSync(keptUnreadableAs, 'utf8'), '{"count": 3}');
});
