import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { SodiumOff, sodiumSummary } from './SodiumOff.ts';
import { PotatoMode } from '../potato/PotatoMode.ts';

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

const SODIUM_JARS = [
  'sodium-fabric-0.8.12+mc1.21.1.jar',
  'sodium-extra-fabric-0.9.3+mc1.21.1.jar',
  'reeses-sodium-options-fabric-2.2.3+mc1.21.1.jar',
  'iris-fabric-1.8.14-beta.1+mc1.21.1.jar',
  'voxy-0.2.15-beta+mc1.21.1.jar',
];

function gameDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-sodium-'));
  fs.mkdirSync(path.join(dir, 'mods'));
  for (const [name, id] of Object.entries(PACK)) fs.writeFileSync(path.join(dir, 'mods', name), jar(id));
  fs.writeFileSync(path.join(dir, '.karamon-sync-cache.json'), JSON.stringify({ jarNames: Object.keys(PACK) }));
  return dir;
}

function enabledJars(dir: string): string[] {
  return fs.readdirSync(path.join(dir, 'mods')).filter((f) => f.endsWith('.jar')).sort();
}

test('parks Sodium and the mods that need it, then puts them back', () => {
  const dir = gameDir();
  const off = SodiumOff.apply(dir);
  assert.deepEqual(off.errors, []);
  assert.deepEqual([...off.mods].sort(), [...SODIUM_JARS].sort());
  assert.deepEqual(enabledJars(dir), ['karamon-1.0.0.jar', 'particlerain-1.0.jar', 'voxy-server-side-0.14.0-fabric.jar']);
  assert.deepEqual([...SodiumOff.parkedJars(dir)].sort(), [...SODIUM_JARS].sort());
  assert.match(sodiumSummary(true, off), /^Sodium désactivé : .*Sodium Extra/);

  assert.deepEqual(SodiumOff.apply(dir).mods, []);

  const on = SodiumOff.restore(dir);
  assert.deepEqual(on.errors, []);
  assert.deepEqual(enabledJars(dir), Object.keys(PACK).sort());
  assert.deepEqual(SodiumOff.parkedJars(dir), []);
  assert.ok(!fs.existsSync(path.join(dir, '.karamon-sodium-state.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a jar with the right name but another mod id stays on', () => {
  const dir = gameDir();
  fs.writeFileSync(path.join(dir, 'mods', 'iris-fabric-1.8.14-beta.1+mc1.21.1.jar'), jar('something-else'));
  SodiumOff.apply(dir);
  assert.ok(enabledJars(dir).includes('iris-fabric-1.8.14-beta.1+mc1.21.1.jar'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Voxy stays off when the mode PC modeste is turned off while Sodium is off', () => {
  const dir = gameDir();
  PotatoMode.apply(dir);
  SodiumOff.apply(dir);
  PotatoMode.restore(dir);
  SodiumOff.apply(dir);
  assert.ok(!enabledJars(dir).includes('voxy-0.2.15-beta+mc1.21.1.jar'));
  assert.ok(enabledJars(dir).includes('particlerain-1.0.jar'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Voxy stays off when Sodium comes back while the mode PC modeste is on', () => {
  const dir = gameDir();
  SodiumOff.apply(dir);
  PotatoMode.apply(dir);
  SodiumOff.restore(dir);
  PotatoMode.apply(dir);
  assert.ok(!enabledJars(dir).includes('voxy-0.2.15-beta+mc1.21.1.jar'));
  assert.ok(enabledJars(dir).includes('sodium-fabric-0.8.12+mc1.21.1.jar'));
  fs.rmSync(dir, { recursive: true, force: true });
});
