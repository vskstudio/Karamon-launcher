import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { potatoModFor } from './PotatoMods.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { reconcilePlayerToggles } from '../minecraft/PlayerToggles.ts';

function jar(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, environment: 'client' })));
  return zip.toBuffer();
}

function gameDir(jars: Record<string, Buffer>): GameInstance {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-potato-'));
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  for (const [name, data] of Object.entries(jars)) fs.writeFileSync(path.join(dir, 'mods', name), data);
  return new GameInstance(dir);
}

function potato(instance: GameInstance, on: boolean, packJars: string[] | null): string[] {
  const lines: string[] = [];
  reconcilePlayerToggles(instance, { potatoMode: on, disableSodium: false }, packJars && new Set(packJars), 'potato', (l) => lines.push(l));
  return lines;
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

test('on then off: settings, shaders and mods come back as they were', () => {
  const voxy = jar('voxy');
  const jars = ['voxy-0.2.15-beta+mc1.21.1.jar', 'voxy-server-side-0.14.0-fabric.jar', 'karamon-1.0.0.jar', 'particular-1.0.jar'];
  const instance = gameDir({
    'voxy-0.2.15-beta+mc1.21.1.jar': voxy,
    'voxy-server-side-0.14.0-fabric.jar': jar('lss'),
    'karamon-1.0.0.jar': jar('karamon'),
    'particular-1.0.jar': jar('something-else'),
  });
  const mods = instance.modsDir;
  fs.writeFileSync(instance.optionsFile, OPTIONS);
  fs.writeFileSync(instance.irisProperties, IRIS);

  const on = potato(instance, true, jars);
  assert.deepEqual(on.filter((l) => l.includes('fichier ignoré')), []);
  assert.match(on.join('\n'), /désactivé : Voxy/);
  assert.ok(fs.existsSync(path.join(mods, 'voxy-0.2.15-beta+mc1.21.1.jar.disabled')));
  assert.ok(!fs.existsSync(path.join(mods, 'voxy-0.2.15-beta+mc1.21.1.jar')));
  for (const kept of ['voxy-server-side-0.14.0-fabric.jar', 'karamon-1.0.0.jar', 'particular-1.0.jar']) {
    assert.ok(fs.existsSync(path.join(mods, kept)), kept);
  }
  assert.match(fs.readFileSync(instance.optionsFile, 'utf8'), /^renderDistance:6$/m);
  assert.match(fs.readFileSync(instance.irisProperties, 'utf8'), /^enableShaders=false$/m);

  potato(instance, true, jars);
  assert.ok(fs.existsSync(path.join(mods, 'voxy-0.2.15-beta+mc1.21.1.jar.disabled')));

  const off = potato(instance, false, jars);
  assert.match(off.join('\n'), /réactivé : Voxy/);
  assert.deepEqual(fs.readFileSync(path.join(mods, 'voxy-0.2.15-beta+mc1.21.1.jar')), voxy);
  assert.ok(!fs.existsSync(path.join(mods, 'voxy-0.2.15-beta+mc1.21.1.jar.disabled')));
  assert.equal(fs.readFileSync(instance.optionsFile, 'utf8'), OPTIONS);
  assert.equal(fs.readFileSync(instance.irisProperties, 'utf8'), IRIS);
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('a mod update while on: the new jar is switched off, the old switched-off one removed', () => {
  const instance = gameDir({ 'particlerain-1.0.jar': jar('particlerain') });
  potato(instance, true, ['particlerain-1.0.jar']);
  fs.writeFileSync(path.join(instance.modsDir, 'particlerain-2.0.jar'), jar('particlerain'));
  potato(instance, true, ['particlerain-2.0.jar']);
  assert.deepEqual(fs.readdirSync(instance.modsDir), ['particlerain-2.0.jar.disabled']);
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('missing files, an empty folder and a corrupt state never throw', () => {
  const instance = new GameInstance(fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-potato-empty-')));
  assert.deepEqual(potato(instance, true, null), ['Mode PC modeste actif.']);
  assert.deepEqual(potato(instance, false, null), ['Mode PC modeste coupé.']);
  fs.writeFileSync(instance.potatoState, '\0\0\0');
  fs.writeFileSync(instance.modTogglesState, '\0\0\0');
  assert.deepEqual(potato(instance, false, null), ['Mode PC modeste coupé.']);
  fs.mkdirSync(instance.configDir);
  fs.writeFileSync(path.join(instance.configDir, 'sodium-options.json'), '{ broken');
  const lines = potato(instance, true, null);
  assert.equal(lines.filter((l) => l.startsWith('Mode PC modeste, fichier ignoré')).length, 1);
  assert.equal(fs.readFileSync(path.join(instance.configDir, 'sodium-options.json'), 'utf8'), '{ broken');
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('turning the mode off after the switched-off jar was deleted forgets it, so the sync downloads it again', () => {
  const instance = gameDir({ 'voxy-0.3.jar': jar('voxy') });
  potato(instance, true, ['voxy-0.3.jar']);
  fs.rmSync(path.join(instance.modsDir, 'voxy-0.3.jar.disabled'));
  const off = potato(instance, false, ['voxy-0.3.jar']);
  assert.deepEqual(off.filter((l) => l.includes('fichier ignoré')), []);
  potato(instance, true, ['voxy-0.3.jar']);
  assert.deepEqual(fs.readdirSync(instance.modsDir), []);
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('a jar switched off by an older launcher comes back when the mode is turned off', () => {
  const instance = gameDir({ 'voxy-0.3.jar.disabled': jar('voxy') });
  fs.writeFileSync(instance.potatoState, JSON.stringify({ version: 1, files: {}, mods: ['voxy-0.3.jar'] }));
  potato(instance, false, ['voxy-0.3.jar']);
  assert.deepEqual(fs.readdirSync(instance.modsDir), ['voxy-0.3.jar']);
  fs.rmSync(instance.dir, { recursive: true, force: true });
});
