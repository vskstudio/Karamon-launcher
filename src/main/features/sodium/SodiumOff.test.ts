import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { GameInstance } from '../../shared/GameInstance.ts';
import { reconcilePlayerToggles, type ToggleSettings } from '../minecraft/PlayerToggles.ts';

function jar(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, environment: 'client' })));
  return zip.toBuffer();
}

const PACK: Record<string, string> = {
  'sodium-fabric-0.8.12+mc1.21.1.jar': 'sodium',
  'sodium-extra-fabric-0.9.3+mc1.21.1.jar': 'sodium-extra',
  'reeses-sodium-options-fabric-2.2.3+mc1.21.1.jar': 'reeses-sodium-options',
  'iris-fabric-1.8.14-beta.1+mc1.21.1.jar': 'iris',
  'voxy-0.2.15-beta+mc1.21.1.jar': 'voxy',
  'voxy-server-side-0.14.0-fabric.jar': 'lss',
  'karamon-1.0.0.jar': 'karamon',
  'particlerain-1.0.jar': 'particlerain',
};
const PACK_JARS = new Set(Object.keys(PACK));

function gameDir(): GameInstance {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sodium-'));
  fs.mkdirSync(path.join(dir, 'mods'));
  for (const [name, id] of Object.entries(PACK)) fs.writeFileSync(path.join(dir, 'mods', name), jar(id));
  return new GameInstance(dir);
}

function enabledJars(instance: GameInstance): string[] {
  return fs.readdirSync(instance.modsDir).filter((f) => f.endsWith('.jar')).sort();
}

function toggle(instance: GameInstance, settings: ToggleSettings, trigger: 'potato' | 'sodium' = 'sodium'): string[] {
  const lines: string[] = [];
  reconcilePlayerToggles(instance, settings, PACK_JARS, trigger, (l) => lines.push(l));
  return lines;
}

test('switches Sodium and the mods that need it off, then puts them back', () => {
  const instance = gameDir();
  const off = toggle(instance, { potatoMode: false, disableSodium: true });
  assert.deepEqual(enabledJars(instance), ['karamon-1.0.0.jar', 'particlerain-1.0.jar', 'voxy-server-side-0.14.0-fabric.jar']);
  assert.match(off.join('\n'), /^Sodium désactivé : .*Sodium Extra/m);

  const on = toggle(instance, { potatoMode: false, disableSodium: false });
  assert.match(on.join('\n'), /^Sodium réactivé : .*Iris/m);
  assert.deepEqual(enabledJars(instance), [...PACK_JARS].sort());
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('a jar with the right name but another mod id stays on', () => {
  const instance = gameDir();
  fs.writeFileSync(path.join(instance.modsDir, 'iris-fabric-1.8.14-beta.1+mc1.21.1.jar'), jar('something-else'));
  toggle(instance, { potatoMode: false, disableSodium: true });
  assert.ok(enabledJars(instance).includes('iris-fabric-1.8.14-beta.1+mc1.21.1.jar'));
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('Voxy stays off as long as one of the two settings wants it off', () => {
  const instance = gameDir();
  const voxy = 'voxy-0.2.15-beta+mc1.21.1.jar';
  toggle(instance, { potatoMode: true, disableSodium: true });
  toggle(instance, { potatoMode: false, disableSodium: true }, 'potato');
  assert.ok(!enabledJars(instance).includes(voxy));
  assert.ok(enabledJars(instance).includes('particlerain-1.0.jar'));

  toggle(instance, { potatoMode: true, disableSodium: true }, 'potato');
  toggle(instance, { potatoMode: true, disableSodium: false });
  assert.ok(!enabledJars(instance).includes(voxy));
  assert.ok(enabledJars(instance).includes('sodium-fabric-0.8.12+mc1.21.1.jar'));

  toggle(instance, { potatoMode: false, disableSodium: false }, 'potato');
  assert.deepEqual(enabledJars(instance), [...PACK_JARS].sort());
  fs.rmSync(instance.dir, { recursive: true, force: true });
});

test('Sodium switched off by an older launcher comes back when the setting is turned off', () => {
  const instance = gameDir();
  const parkedByOldLauncher = [
    'sodium-fabric-0.8.12+mc1.21.1.jar',
    'sodium-extra-fabric-0.9.3+mc1.21.1.jar',
    'reeses-sodium-options-fabric-2.2.3+mc1.21.1.jar',
    'iris-fabric-1.8.14-beta.1+mc1.21.1.jar',
    'voxy-0.2.15-beta+mc1.21.1.jar',
  ];
  for (const name of parkedByOldLauncher) fs.renameSync(path.join(instance.modsDir, name), path.join(instance.modsDir, name + '.disabled'));
  fs.writeFileSync(instance.legacySodiumState, JSON.stringify({ version: 1, mods: parkedByOldLauncher }, null, 2));

  toggle(instance, { potatoMode: false, disableSodium: false });

  assert.deepEqual(enabledJars(instance), [...PACK_JARS].sort());
  assert.deepEqual(fs.readdirSync(instance.modsDir).filter((f) => f.endsWith('.disabled')), []);
  assert.equal(fs.existsSync(instance.legacySodiumState), false);
  fs.rmSync(instance.dir, { recursive: true, force: true });
});
