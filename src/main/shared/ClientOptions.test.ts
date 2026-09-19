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
  });
});

test('parseClientOptions rejects a missing shader', () => {
  assert.equal(parseClientOptions({ resourcePacks: ['vanilla'] }), null);
});
