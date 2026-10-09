import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPTIONS_RULES,
  SODIUM_RULES,
  applyRules,
  atLeast,
  atMost,
  cheapest,
  emptyBackup,
  jsonDoc,
  keyValueDoc,
  lowEndReasons,
  potatoJvmArgs,
  potatoMemoryCapMb,
  potatoMemoryMb,
  restoreRules,
} from './PotatoSettings.ts';

test('atMost lowers, never raises, and writes the target for an absent key above it', () => {
  const lower = atMost('6', 12);
  assert.equal(lower('12'), '6');
  assert.equal(lower('6'), null);
  assert.equal(lower('4'), null);
  assert.equal(lower(undefined), '6');
  assert.equal(lower('abc'), '6');
  assert.equal(atMost('0', 0)(undefined), null);
  assert.equal(atMost('0.75', 1)('1.0'), '0.75');
  assert.equal(atMost('0.75', 1)('0.5'), null);
});

test('atLeast and cheapest keep a setting that is already lower', () => {
  assert.equal(atLeast('2', 0)('0'), '2');
  assert.equal(atLeast('2', 0)('2'), null);
  const clouds = cheapest(['"false"', '"fast"', '"true"'], '"false"', '"true"');
  assert.equal(clouds('"true"'), '"false"');
  assert.equal(clouds('"fast"'), '"false"');
  assert.equal(clouds('"false"'), null);
  assert.equal(clouds(undefined), '"false"');
  assert.equal(clouds('"weird"'), '"false"');
});

test('options.txt: only lowers, keeps unknown lines and CRLF, then restores the player values', () => {
  const original = [
    'version:3955',
    'renderDistance:16',
    'simulationDistance:4',
    'graphicsMode:1',
    'ao:true',
    'particles:1',
    'renderClouds:"fast"',
    'entityShadows:false',
    'mipmapLevels:4',
    'entityDistanceScaling:1.0',
    'resourcePacks:["vanilla"]',
    '',
  ].join('\r\n');
  const doc = keyValueDoc(original, ':');
  const backup = emptyBackup();
  const written = applyRules(doc, OPTIONS_RULES, backup);
  const text = doc.serialize();

  assert.match(text, /\r\nrenderDistance:6\r\n/);
  assert.match(text, /\r\nsimulationDistance:4\r\n/, 'already lower than 5: untouched');
  assert.match(text, /\r\ngraphicsMode:0\r\n/);
  assert.match(text, /\r\nao:false\r\n/);
  assert.match(text, /\r\nparticles:2\r\n/);
  assert.match(text, /\r\nrenderClouds:"false"\r\n/);
  assert.match(text, /\r\nentityDistanceScaling:0.75\r\n/);
  assert.match(text, /resourcePacks:\["vanilla"\]/);
  assert.match(text, /biomeBlendRadius:0/, 'absent key added at its lowered value');
  assert.ok(text.endsWith('\r\n'));
  assert.ok(!written.includes('simulationDistance'));
  assert.ok(!written.includes('entityShadows'));
  assert.equal(backup.before.renderDistance, '16');
  assert.equal(backup.before.biomeBlendRadius, null);

  // Second launch while on: nothing to write, backup still holds the first values.
  const again = keyValueDoc(text, ':');
  assert.deepEqual(applyRules(again, OPTIONS_RULES, backup), []);
  assert.equal(backup.before.renderDistance, '16');

  // The player changes the clouds in game, then turns the mode off.
  const played = keyValueDoc(text.replace('renderClouds:"false"', 'renderClouds:"true"'), ':');
  const restored = restoreRules(played, backup);
  const back = played.serialize();
  assert.ok(!restored.includes('renderClouds'));
  assert.match(back, /\r\nrenderClouds:"true"\r\n/, 'the player choice made since stays');
  assert.match(back, /\r\nrenderDistance:16\r\n/);
  assert.match(back, /\r\ngraphicsMode:1\r\n/);
  assert.match(back, /\r\nao:true\r\n/);
  assert.match(back, /\r\nentityDistanceScaling:1.0\r\n/);
  assert.doesNotMatch(back, /biomeBlendRadius/, 'a key the mode added is removed again');
  assert.equal(back, original.replace('renderClouds:"fast"', 'renderClouds:"true"'));
});

test('a second apply does not overwrite the backup taken when the mode was turned on', () => {
  const backup = emptyBackup();
  const doc = keyValueDoc('renderDistance:12\n', ':');
  applyRules(doc, OPTIONS_RULES, backup);
  doc.set('renderDistance', '10'); // raised in game while the mode is on
  applyRules(doc, OPTIONS_RULES, backup);
  assert.equal(doc.get('renderDistance'), '6');
  assert.equal(backup.before.renderDistance, '12');
});

test('iris.properties keeps comments and the selected shader', () => {
  const doc = keyValueDoc('#Iris\nenableShaders=true\nshaderPack=COBBLEVERSE - Shaders\n', '=');
  const backup = emptyBackup();
  applyRules(doc, [{ key: 'enableShaders', lower: cheapest(['false', 'true'], 'false', 'true') }], backup);
  assert.equal(doc.serialize(), '#Iris\nenableShaders=false\nshaderPack=COBBLEVERSE - Shaders\n');
  restoreRules(doc, backup);
  assert.equal(doc.serialize(), '#Iris\nenableShaders=true\nshaderPack=COBBLEVERSE - Shaders\n');
});

test('sodium-options.json: dotted paths, fast leaves, restore', () => {
  const original = JSON.stringify(
    {
      quality: { weather_quality: 'DEFAULT', leaves_quality: 'FANCY', enable_vignette: true },
      performance: { use_entity_culling: false, use_fog_occlusion: true },
      notifications: { has_seen_donation_prompt: true },
    },
    null,
    2,
  );
  const doc = jsonDoc(original);
  const backup = emptyBackup();
  applyRules(doc, SODIUM_RULES, backup);
  const lowered = JSON.parse(doc.serialize());
  assert.equal(lowered.quality.leaves_quality, 'FAST');
  assert.equal(lowered.quality.weather_quality, 'FAST');
  assert.equal(lowered.quality.enable_vignette, false);
  assert.equal(lowered.performance.use_entity_culling, true);
  // Absent: Sodium's default is already the cheap one, nothing added.
  assert.equal(lowered.performance.use_block_face_culling, undefined);
  assert.equal(lowered.notifications.has_seen_donation_prompt, true);

  restoreRules(doc, backup);
  assert.deepEqual(JSON.parse(doc.serialize()), JSON.parse(original));
  assert.throws(() => jsonDoc('[1, 2]'));
});

test('lowEndReasons: RAM, Intel-only GPU, few threads', () => {
  assert.deepEqual(lowEndReasons({ totalMemMb: 16000, cpuCount: 12, gpus: [{ vendorId: 0x10de }] }), []);
  assert.deepEqual(lowEndReasons({ totalMemMb: 7900, cpuCount: 8, gpus: [] }), ['8 Go de RAM']);
  assert.deepEqual(lowEndReasons({ totalMemMb: 16000, cpuCount: 8, gpus: [{ vendorId: 0x8086 }] }), [
    'carte graphique intégrée',
  ]);
  // Intel iGPU + NVIDIA card: the laptop has a real GPU.
  assert.deepEqual(
    lowEndReasons({ totalMemMb: 16000, cpuCount: 8, gpus: [{ vendorId: 0x8086 }, { vendorId: 0x10de }] }),
    [],
  );
  // Software renderer only (vendor unknown): not reported.
  assert.deepEqual(lowEndReasons({ totalMemMb: 16000, cpuCount: 8, gpus: [{ vendorId: 0x1ae0 }] }), []);
  assert.deepEqual(lowEndReasons({ totalMemMb: 12000, cpuCount: 4, gpus: [] }), ['4 threads']);
});

test('potato memory: capped on 8 Go or less, never raised, untouched above', () => {
  assert.equal(potatoMemoryCapMb(16000), null);
  assert.equal(potatoMemoryCapMb(7900), 3072);
  assert.equal(potatoMemoryCapMb(6000), 2560);
  assert.equal(potatoMemoryCapMb(3900), 2048);
  assert.equal(potatoMemoryMb(7900, 12288), 3072);
  assert.equal(potatoMemoryMb(7900, 2560), 2560);
  assert.equal(potatoMemoryMb(16000, 12288), 12288);
  for (const total of [3000, 4000, 6000, 8192, 8704]) {
    assert.ok(potatoMemoryMb(total, 99999) < total, `${total} Mo`);
  }
});

test('potato JVM flags only when the player chose no collector', () => {
  assert.deepEqual(potatoJvmArgs(''), ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', '-XX:+UseStringDeduplication']);
  assert.deepEqual(potatoJvmArgs('-XX:+UseZGC -XX:+ZGenerational'), []);
  assert.deepEqual(potatoJvmArgs('-XX:+UseSerialGC -XX:TieredStopAtLevel=1'), []);
});
