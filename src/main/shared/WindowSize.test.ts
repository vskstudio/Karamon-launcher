import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialWindowSize, interfaceScale, minimumWindowSize } from './WindowSize.ts';

test('a 1080p screen opens the launcher at 1366x768 without zoom', () => {
  assert.equal(interfaceScale({ width: 1920, height: 1032 }), 1);
  assert.deepEqual(initialWindowSize({ width: 1920, height: 1032 }), { width: 1366, height: 768 });
});

test('a 1440p screen zooms the interface by a quarter so text keeps its size on screen', () => {
  assert.equal(interfaceScale({ width: 2560, height: 1400 }), 1.25);
  assert.deepEqual(initialWindowSize({ width: 2560, height: 1400 }), { width: 1708, height: 960 });
});

test('a 4K screen at 100 % scaling zooms the interface instead of opening a tiny window', () => {
  assert.equal(interfaceScale({ width: 3840, height: 2120 }), 1.75);
  assert.deepEqual(initialWindowSize({ width: 3840, height: 2120 }), { width: 2391, height: 1344 });
});

test('the zoom never goes past twice the size, even on a huge screen', () => {
  assert.equal(interfaceScale({ width: 7680, height: 4320 }), 2);
});

test('a small screen gets the largest 16:9 window that leaves room around it', () => {
  assert.deepEqual(initialWindowSize({ width: 1366, height: 728 }), { width: 1164, height: 655 });
});

test('a tall screen is limited by its width', () => {
  assert.deepEqual(initialWindowSize({ width: 1280, height: 1600 }), { width: 1152, height: 648 });
});

test('the minimum size stays 16:9, follows the zoom and never exceeds the initial size', () => {
  assert.deepEqual(minimumWindowSize({ width: 1920, height: 1032 }), { width: 1024, height: 576 });
  assert.deepEqual(minimumWindowSize({ width: 2560, height: 1400 }), { width: 1280, height: 720 });
  assert.deepEqual(minimumWindowSize({ width: 1024, height: 700 }), { width: 921, height: 518 });
});
