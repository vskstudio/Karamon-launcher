import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTotalSize, planByteRanges } from './HttpClient.ts';

test('planByteRanges splits a file into contiguous byte ranges', () => {
  assert.deepEqual(planByteRanges(1000, 4), [
    { start: 0, end: 249 },
    { start: 250, end: 499 },
    { start: 500, end: 749 },
    { start: 750, end: 999 },
  ]);
});

test('planByteRanges keeps the remainder on the last part', () => {
  assert.deepEqual(planByteRanges(10, 3), [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 9 },
  ]);
});

test('planByteRanges does not invent empty ranges', () => {
  assert.deepEqual(planByteRanges(2, 8), [
    { start: 0, end: 0 },
    { start: 1, end: 1 },
  ]);
  assert.deepEqual(planByteRanges(0, 8), []);
});

test('parseTotalSize reads Content-Range from a 206 probe', () => {
  assert.equal(parseTotalSize({ 'content-range': 'bytes 0-0/378064364' }, 206), 378064364);
  assert.equal(parseTotalSize({ 'content-length': '123' }, 200), 123);
  assert.equal(parseTotalSize({}, 206), 0);
});
