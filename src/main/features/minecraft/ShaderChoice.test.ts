import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { ShaderPolicy } from './ShaderChoice.ts';
import { OptionsWriter } from './OptionsWriter.ts';

function game(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-shader-'));
  fs.mkdirSync(path.join(dir, 'shaderpacks', 'KARAMON - Shader'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shaderpacks', 'Autre Shader'), { recursive: true });
  return dir;
}

function iris(dir: string): string {
  return fs.readFileSync(path.join(dir, 'config', 'iris.properties'), 'utf8');
}

function setIris(dir: string, pack: string, enabled: boolean): void {
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'iris.properties'), `enableShaders=${enabled}\nshaderPack=${pack}\n`);
}

/** One launch: the policy is rebuilt from disk each time, like a new sync. */
function launch(dir: string, revision: number): boolean {
  const policy = new ShaderPolicy(dir);
  const applied = policy.applyChoice(new OptionsWriter(dir), 'KARAMON - Shader', true, revision);
  policy.save();
  return applied;
}

const crc = (s: string): number => zlib.crc32(Buffer.from(s));

test('1re installation : le shader du pack est sélectionné', () => {
  const dir = game();
  assert.equal(launch(dir, 0), true);
  assert.match(iris(dir), /^shaderPack=KARAMON - Shader$/m);
  assert.match(iris(dir), /^enableShaders=true$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('le choix du joueur (autre shader, ou shaders coupés) est gardé aux lancements suivants', () => {
  const dir = game();
  launch(dir, 0);
  setIris(dir, 'Autre Shader', false);
  for (let i = 0; i < 3; i++) assert.equal(launch(dir, 0), false);
  assert.match(iris(dir), /^shaderPack=Autre Shader$/m);
  assert.match(iris(dir), /^enableShaders=false$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un joueur déjà installé avant cette version garde son choix', () => {
  const dir = game();
  setIris(dir, 'Autre Shader', true);
  assert.equal(launch(dir, 0), false);
  assert.match(iris(dir), /^shaderPack=Autre Shader$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shaderRevision relevé : le shader du pack est imposé une seule fois', () => {
  const dir = game();
  launch(dir, 1);
  setIris(dir, 'Autre Shader', false);
  assert.equal(launch(dir, 2), true);
  assert.match(iris(dir), /^shaderPack=KARAMON - Shader$/m);
  assert.match(iris(dir), /^enableShaders=true$/m);
  setIris(dir, 'Autre Shader', false);
  assert.equal(launch(dir, 2), false);
  assert.match(iris(dir), /^shaderPack=Autre Shader$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('le shader choisi est absent du dossier (Euphoria pas encore généré) : le choix est gardé', () => {
  const dir = game();
  launch(dir, 0);
  setIris(dir, 'ComplementaryUnbound_r5.9.3 + EuphoriaPatches_1.10.5', true);
  assert.equal(launch(dir, 0), false);
  assert.match(iris(dir), /^shaderPack=ComplementaryUnbound_r5\.9\.3 \+ EuphoriaPatches_1\.10\.5$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aucun shader sélectionné (iris.properties effacé) : on remet celui du pack', () => {
  const dir = game();
  launch(dir, 0);
  fs.rmSync(path.join(dir, 'config', 'iris.properties'));
  assert.equal(launch(dir, 0), true);
  assert.match(iris(dir), /^shaderPack=KARAMON - Shader$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('réglages .txt : modifiés par le joueur = gardés, intacts = mis à jour, bump = remplacés', async () => {
  const dir = game();
  const txt = path.join(dir, 'shaderpacks', 'KARAMON - Shader.txt');

  // 1re synchro : fichier absent, on l'écrit.
  let policy = new ShaderPolicy(dir);
  policy.setRevision(1);
  assert.equal(await policy.keepSettings(txt, crc('v1')), false);
  fs.writeFileSync(txt, 'v1');
  policy.applyChoice(new OptionsWriter(dir), 'KARAMON - Shader', true, 1);
  policy.save();

  // Le pack publie v2, le joueur n'a pas touché au fichier : mis à jour.
  policy = new ShaderPolicy(dir);
  policy.setRevision(1);
  assert.equal(await policy.keepSettings(txt, crc('v2')), false);
  fs.writeFileSync(txt, 'v2');
  policy.save();

  // Le joueur règle ses shaders, le pack publie v3 : le réglage du joueur est gardé.
  fs.writeFileSync(txt, 'mes réglages');
  policy = new ShaderPolicy(dir);
  policy.setRevision(1);
  assert.equal(await policy.keepSettings(txt, crc('v3')), true);
  policy.save();
  assert.equal(fs.readFileSync(txt, 'utf8'), 'mes réglages');

  // Le pack relève shaderRevision : le fichier du pack remplace celui du joueur.
  policy = new ShaderPolicy(dir);
  policy.setRevision(2);
  assert.equal(await policy.keepSettings(txt, crc('v3')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('réglages .txt : 1re synchro avec cette version, le fichier existant du joueur est gardé', async () => {
  const dir = game();
  const txt = path.join(dir, 'shaderpacks', 'KARAMON - Shader.txt');
  fs.writeFileSync(txt, 'mes réglages');
  const policy = new ShaderPolicy(dir);
  assert.equal(await policy.keepSettings(txt, crc('pack')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
