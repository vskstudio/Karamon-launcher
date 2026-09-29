import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialWindowSize, minimumWindowSize } from './WindowSize.ts';

test('a 1440p screen opens the launcher at 1366x768', () => {
  assert.deepEqual(initialWindowSize({ width: 2560, height: 1400 }), { width: 1366, height: 768 });
});

test('a 1080p screen also opens it at 1366x768', () => {
  assert.deepEqual(initialWindowSize({ width: 1920, height: 1032 }), { width: 1366, height: 768 });
});

test('a small screen gets the largest 16:9 window that leaves room around it', () => {
  assert.deepEqual(initialWindowSize({ width: 1366, height: 728 }), { width: 1164, height: 655 });
});

test('a tall screen is limited by its width', () => {
  assert.deepEqual(initialWindowSize({ width: 1280, height: 1600 }), { width: 1152, height: 648 });
});

test('the minimum size stays 16:9 and never exceeds the initial size', () => {
  assert.deepEqual(minimumWindowSize({ width: 2560, height: 1400 }), { width: 1024, height: 576 });
  assert.deepEqual(minimumWindowSize({ width: 1024, height: 700 }), { width: 921, height: 518 });
});

