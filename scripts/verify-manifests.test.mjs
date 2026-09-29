import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { manifestProblems } from './verify-manifests.mjs';

function withArtifacts(files, check) {
  const dir = mkdtempSync(join(tmpdir(), 'karamon-manifests-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const windowsManifest = (file) =>
  `version: 2.0.15\nfiles:\n  - url: ${file}\n    sha512: abc\n    size: 1\npath: ${file}\nsha512: abc\n`;

test('a manifest whose files are all published passes', () => {
  withArtifacts(
    {
      'latest.yml': windowsManifest('Karamon-Launcher-Setup-2.0.15.exe'),
      'Karamon-Launcher-Setup-2.0.15.exe': 'x',
    },
    (dir) => assert.deepEqual(manifestProblems(dir), []),
  );
});

test('a manifest pointing at a file missing from the artifacts fails', () => {
  withArtifacts(
    {
      'latest.yml': windowsManifest('Karamon-Launcher-Setup-2.0.15.exe'),
      'Karamon-Launcher-Setup-2.0.14.exe': 'x',
    },
    (dir) => assert.equal(manifestProblems(dir).length, 2),
  );
});

test('a file name with a space fails even when the manifest matches it', () => {
  withArtifacts(
    {
      'latest.yml': windowsManifest("'Karamon Launcher Setup 2.0.15.exe'"),
      'Karamon Launcher Setup 2.0.15.exe': 'x',
    },
    (dir) => assert.equal(manifestProblems(dir).length, 3),
  );
});

test('artifacts without any manifest fail', () => {
  withArtifacts({ 'Karamon-Launcher-2.0.15.AppImage': 'x' }, (dir) => {
    assert.deepEqual(manifestProblems(dir), [`Aucun manifeste latest*.yml dans ${dir}.`]);
  });
});
