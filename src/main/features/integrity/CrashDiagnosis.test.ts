import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectCorruption,
  EARLY_CRASH_WINDOW_MS,
  isEarlyCrash,
  readCrashEvidence,
} from './CrashDiagnosis.ts';

test('reconnaît un jar tronqué', () => {
  const text = 'java.util.zip.ZipException: zip END header not found\n\tat java.base/java.util.zip.ZipFile';
  assert.equal(detectCorruption(text).length, 2);
  assert.match(detectCorruption(text)[0], /zip END header not found/);
});

test('reconnaît l’analyse de mod en échec de Fabric', () => {
  const text = 'net.fabricmc.loader.impl.FormattedException: Error analyzing [/game/mods/voxy.jar]: java.util.zip.ZipException';
  assert.ok(detectCorruption(text).some((r) => r.includes('Error analyzing')));
});

test('reconnaît un config rempli de NUL dans une erreur JSON', () => {
  const gson = [
    'com.google.gson.JsonSyntaxException: java.lang.IllegalStateException: Expected BEGIN_OBJECT but was STRING at line 1 column 1 path $',
    'Caused by: "\\u0000\\u0000\\u0000\\u0000"',
  ].join('\n');
  assert.equal(detectCorruption(gson).length, 1);
  assert.equal(detectCorruption('com.google.gson.JsonParseException: Not a JSON Object: "\\u0000\\u0000"').length, 1);
  assert.equal(detectCorruption('Malformed JSON: \u0000\u0000\u0000').length, 1);
});

test('ignore un crash sans rapport avec des fichiers abîmés', () => {
  assert.deepEqual(detectCorruption('java.lang.OutOfMemoryError: Java heap space'), []);
  assert.deepEqual(detectCorruption('Loading config.json\n' + 'x\n'.repeat(10) + 'value \\u0000 escaped'), []);
});

test('ne considère que les sorties en erreur dans les deux premières minutes', () => {
  assert.equal(isEarlyCrash(1, 0, 30_000), true);
  assert.equal(isEarlyCrash(-1, 0, EARLY_CRASH_WINDOW_MS), true);
  assert.equal(isEarlyCrash(0, 0, 30_000), false);
  assert.equal(isEarlyCrash(1, 0, EARLY_CRASH_WINDOW_MS + 1), false);
});

test('lit le dernier rapport de crash de la session et la fin de latest.log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-evidence-'));
  const reports = path.join(dir, 'crash-reports');
  fs.mkdirSync(reports);
  fs.mkdirSync(path.join(dir, 'logs'));
  const old = path.join(reports, 'crash-old.txt');
  fs.writeFileSync(old, 'ancien: ZipException');
  const past = new Date(Date.now() - 3_600_000);
  fs.utimesSync(old, past, past);
  fs.writeFileSync(path.join(reports, 'crash-new.txt'), 'nouveau rapport');
  fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), 'fin du log');

  const evidence = readCrashEvidence(dir, Date.now() - 1000);
  assert.match(evidence, /nouveau rapport/);
  assert.match(evidence, /fin du log/);
  assert.doesNotMatch(evidence, /ancien/);
  assert.equal(readCrashEvidence(path.join(dir, 'absent'), Date.now()), '');
  fs.rmSync(dir, { recursive: true, force: true });
});
