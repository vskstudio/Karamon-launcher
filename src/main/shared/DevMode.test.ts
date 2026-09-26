import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevMode } from './DevMode.ts';

test('dev mode is forced by --dev or KARAMON_DEV=1', () => {
  assert.equal(DevMode.forced(['electron', '.', '--dev'], {}), true);
  assert.equal(DevMode.forced(['electron', '.'], { KARAMON_DEV: '1' }), true);
  assert.equal(DevMode.forced(['electron', '.'], {}), false);
  assert.equal(DevMode.forced(['electron', '.'], { KARAMON_DEV: '0' }), false);
});

test('the JVM flag matches what the Karamon mod reads', () => {
  assert.equal(DevMode.JVM_FLAG, '-Dkaramon.dev=true');
});
