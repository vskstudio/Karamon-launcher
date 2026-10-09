import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { PotatoMode, potatoSummary } from './PotatoMode.ts';
import { potatoModFor } from './PotatoMods.ts';

function jar(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, environment: 'client' })));
  return zip.toBuffer();
}

function gameDir(jars: Record<string, Buffer>, packJars?: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-potato-'));
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  for (const [name, data] of Object.entries(jars)) fs.writeFileSync(path.join(dir, 'mods', name), data);
  if (packJars) {
    fs.writeFileSync(path.join(dir, '.karamon-sync-cache.json'), JSON.stringify({ jarNames: packJars }));
  }
  return dir;
}

const OPTIONS = 'renderDistance:12\nao:true\nresourcePacks:["vanilla"]\n';
const IRIS = '#Iris\nenableShaders=true\nshaderPack=COBBLEVERSE - Shaders\n';

test('never targets Karamon, Cobblemon or Voxy Server Side', () => {
  for (const name of [
    'karamon-1.0.0.jar',
    'karamon-cosmetica-1.0.0.jar',
    'Cobblemon-fabric-1.7.3+1.21.1.jar',
    'lootbox-1.0.0.jar',
    'voxy-server-side-0.14.0-fabric.jar',
    'voxy-server-side-fabric.jar',
    'iris-fabric-1.8.14-beta.1+mc1.21.1.jar',
    'sodium-fabric-0.8.12+mc1.21.1.jar',
    'voxy-0.2.15-beta+mc1.21.1.jar.disabled',
  ]) {
    assert.equal(potatoModFor(name), null, name);
  }
  assert.equal(potatoModFor('voxy-0.2.15-beta+mc1.21.1.jar')?.id, 'voxy');
  assert.equal(potatoModFor('particular-1.21.1-Fabric-1.5.5.jar')?.id, 'particular');
  assert.equal(potatoModFor('particlerain-4.0.0-beta.10+1.21.1-fabric.jar')?.id, 'particlerain');
  assert.equal(potatoModFor('sound-physics-remastered-fabric-1.21.1-1.5.1.jar')?.id, 'sound_physics_remastered');
});

test('apply then restore: settings, shaders and mods come back as they were', () => {
  const voxy = jar('voxy');
  const dir = gameDir(
    {
      'voxy-0.2.15-beta+mc1.21.1.jar': voxy,
      'voxy-server-side-0.14.0-fabric.jar': jar('lss'),
      'karamon-1.0.0.jar': jar('karamon'),
      // Right name, wrong id: left alone.
      'particular-1.0.jar': jar('something-else'),
    },
    ['voxy-0.2.15-beta+mc1.21.1.jar', 'voxy-server-side-0.14.0-fabric.jar', 'karamon-1.0.0.jar', 'particular-1.0.jar'],
  );
  fs.writeFileSync(path.join(dir, 'options.txt'), OPTIONS);
  fs.writeFileSync(path.join(dir, 'config', 'iris.properties'), IRIS);

  const on = PotatoMode.apply(dir);
  assert.deepEqual(on.errors, []);
  assert.deepEqual(on.mods, ['voxy-0.2.15-beta+mc1.21.1.jar']);
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'voxy-0.2.15-beta+mc1.21.1.jar.disabled')));
  assert.ok(!fs.existsSync(path.join(dir, 'mods', 'voxy-0.2.15-beta+mc1.21.1.jar')));
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'voxy-server-side-0.14.0-fabric.jar')));
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'karamon-1.0.0.jar')));
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'particular-1.0.jar')));
  assert.match(fs.readFileSync(path.join(dir, 'options.txt'), 'utf8'), /^renderDistance:6$/m);
  assert.match(fs.readFileSync(path.join(dir, 'config', 'iris.properties'), 'utf8'), /^enableShaders=false$/m);
  assert.deepEqual(PotatoMode.parkedJars(dir), ['voxy-0.2.15-beta+mc1.21.1.jar']);
  assert.match(potatoSummary(true, on), /désactivé : Voxy/);

  // Launch again: idempotent.
  const again = PotatoMode.apply(dir);
  assert.deepEqual(again.settings, []);
  assert.deepEqual(again.mods, []);

  const off = PotatoMode.restore(dir);
  assert.deepEqual(off.errors, []);
  assert.deepEqual(off.mods, ['voxy-0.2.15-beta+mc1.21.1.jar']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'mods', 'voxy-0.2.15-beta+mc1.21.1.jar')), voxy);
  assert.ok(!fs.existsSync(path.join(dir, 'mods', 'voxy-0.2.15-beta+mc1.21.1.jar.disabled')));
  assert.equal(fs.readFileSync(path.join(dir, 'options.txt'), 'utf8'), OPTIONS);
  assert.equal(fs.readFileSync(path.join(dir, 'config', 'iris.properties'), 'utf8'), IRIS);
  assert.ok(!fs.existsSync(path.join(dir, '.karamon-potato-state.json')));
  assert.deepEqual(PotatoMode.parkedJars(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a mod update while on: the new jar is parked, the old parked one removed', () => {
  const dir = gameDir({ 'particlerain-1.0.jar': jar('particlerain') }, ['particlerain-1.0.jar']);
  PotatoMode.apply(dir);
  // The sync installs the new version and records it in its cache.
  fs.writeFileSync(path.join(dir, 'mods', 'particlerain-2.0.jar'), jar('particlerain'));
  fs.writeFileSync(path.join(dir, '.karamon-sync-cache.json'), JSON.stringify({ jarNames: ['particlerain-2.0.jar'] }));
  PotatoMode.apply(dir);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), ['particlerain-2.0.jar.disabled']);
  assert.deepEqual(PotatoMode.parkedJars(dir), ['particlerain-2.0.jar']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing files, empty folder and a corrupt state never throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-potato-empty-'));
  assert.deepEqual(PotatoMode.apply(dir), { settings: [], mods: [], errors: [] });
  assert.deepEqual(PotatoMode.restore(dir), { settings: [], mods: [], errors: [] });
  fs.writeFileSync(path.join(dir, '.karamon-potato-state.json'), '\0\0\0');
  assert.deepEqual(PotatoMode.parkedJars(dir), []);
  assert.deepEqual(PotatoMode.restore(dir).errors, []);
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'sodium-options.json'), '{ broken');
  const report = PotatoMode.apply(dir);
  assert.equal(report.errors.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'config', 'sodium-options.json'), 'utf8'), '{ broken');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore when the parked jar was deleted: forgotten, the sync downloads it again', () => {
  const dir = gameDir({ 'voxy-0.3.jar': jar('voxy') }, ['voxy-0.3.jar']);
  PotatoMode.apply(dir);
  fs.rmSync(path.join(dir, 'mods', 'voxy-0.3.jar.disabled'));
  const off = PotatoMode.restore(dir);
  assert.deepEqual(off.errors, []);
  assert.deepEqual(PotatoMode.parkedJars(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
