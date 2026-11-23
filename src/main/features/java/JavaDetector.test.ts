import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JavaDetector } from './JavaDetector.ts';

const posixOnly = { skip: process.platform === 'win32' };

function installFakeJava(root: string, home: string, banner: string): string {
  const bin = path.join(root, home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const java = path.join(bin, 'java');
  fs.writeFileSync(java, `#!/bin/sh\ncat >&2 <<'EOF'\n${banner}\nEOF\n`);
  fs.chmodSync(java, 0o755);
  return java;
}

async function inJvmRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-jvms-'));
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the Java list puts the newest version first, by number and not as text', posixOnly, () =>
  inJvmRoot(async (root) => {
    installFakeJava(root, 'jdk8', 'openjdk version "1.8.0_392"\nOpenJDK Runtime Environment (Temurin)');
    installFakeJava(root, 'jdk9', 'java version "9.0.4"\nJava(TM) SE Runtime Environment');
    installFakeJava(root, 'jdk17', 'openjdk version "17.0.2" 2022-01-18\nOpenJDK Runtime Environment');
    installFakeJava(root, 'jdk21', 'openjdk version "21.0.5" 2024-10-15\nOpenJDK Runtime Environment');
    installFakeJava(root, 'jdk21-newer', 'openjdk version "21.0.10" 2026-01-20\nOpenJDK Runtime Environment');

    const mine = (await new JavaDetector([root]).detect()).filter((java) => java.path.startsWith(root));

    assert.deepEqual(
      mine.map((java) => [java.version, java.major]),
      [['21.0.10', 21], ['21.0.5', 21], ['17.0.2', 17], ['9.0.4', 9], ['1.8.0_392', 8]],
    );
  }),
);

test('a JVM with an unknown vendor stays in the list even when the system has no user name', posixOnly, (t) =>
  inJvmRoot(async (root) => {
    const java = installFakeJava(root, 'custom', 'java version "21.0.5"\nAcme Runtime Environment');
    t.mock.method(os, 'userInfo', () => {
      throw new Error('ENOENT: no passwd entry for uid 1234');
    });

    const found = (await new JavaDetector([root]).detect()).find((install) => install.path === java);

    assert.deepEqual(found, { path: java, version: '21.0.5', major: 21, vendor: '' });
  }),
);

test('the cached Java list shows a runtime installed later once it is invalidated', posixOnly, () =>
  inJvmRoot(async (root) => {
    const detector = new JavaDetector([root]);
    const mine = async (): Promise<string[]> =>
      (await detector.list()).filter((java) => java.path.startsWith(root)).map((java) => java.version);
    assert.deepEqual(await mine(), []);

    installFakeJava(root, 'jre-21', 'openjdk version "21.0.12.1" 2026-08-18 LTS\nOpenJDK Runtime Environment Temurin');

    detector.invalidate();
    assert.deepEqual(await mine(), ['21.0.12.1']);
  }),
);
