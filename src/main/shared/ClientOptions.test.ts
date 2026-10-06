import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClientOptions } from './ClientOptions.ts';

test('parseClientOptions keeps the exact pack list', () => {
  const parsed = parseClientOptions({
    resourcePacks: ['vanilla', 'file/Karamon UI'],
    shaderPack: 'COBBLEVERSE - Shaders',
    enableShaders: true,
  });
  assert.deepEqual(parsed, {
    resourcePacks: ['vanilla', 'file/Karamon UI'],
    shaderPack: 'COBBLEVERSE - Shaders',
    enableShaders: true,
    shaderRevision: 0,
  });
});

test('parseClientOptions reads shaderRevision, 0 when absent or invalid', () => {
  const base = { resourcePacks: ['vanilla'], shaderPack: 'KARAMON - Shader' };
  assert.equal(parseClientOptions({ ...base, shaderRevision: 3 })?.shaderRevision, 3);
  assert.equal(parseClientOptions(base)?.shaderRevision, 0);
  assert.equal(parseClientOptions({ ...base, shaderRevision: '2' })?.shaderRevision, 0);
  assert.equal(parseClientOptions({ ...base, shaderRevision: -1 })?.shaderRevision, 0);
  assert.equal(parseClientOptions({ ...base, shaderRevision: 1.5 })?.shaderRevision, 0);
});

test('parseClientOptions rejects a missing shader', () => {
  assert.equal(parseClientOptions({ resourcePacks: ['vanilla'] }), null);
});
