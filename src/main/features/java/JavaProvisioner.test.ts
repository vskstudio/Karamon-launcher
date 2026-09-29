import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JavaProvisioner } from './JavaProvisioner.ts';
import type { JavaDetector } from './JavaDetector.ts';
import type { DownloadOptions, HttpClient } from '../../shared/HttpClient.ts';
import { Paths } from '../../shared/Paths.ts';

const RUNTIME_FOLDER = 'jdk-21.0.12.1+1-jre';
const ADOPTIUM_API = 'https://api.adoptium.net/v3/assets/latest/21/hotspot';

interface JreLayout {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  adoptiumOs: string;
  adoptiumArch: string;
  javaDir: string[];
}

const LINUX_X64: JreLayout = {
  platform: 'linux',
  arch: 'x64',
  adoptiumOs: 'linux',
  adoptiumArch: 'x64',
  javaDir: [RUNTIME_FOLDER, 'bin'],
};

const MAC_ARM64: JreLayout = {
  platform: 'darwin',
  arch: 'arm64',
  adoptiumOs: 'mac',
  adoptiumArch: 'aarch64',
  javaDir: [RUNTIME_FOLDER, 'Contents', 'Home', 'bin'],
};

function buildJreArchive(dir: string, layout: JreLayout): string {
  const staging = path.join(dir, 'staging');
  const bin = path.join(staging, ...layout.javaDir);
  fs.mkdirSync(bin, { recursive: true });
  const java = path.join(bin, 'java');
  fs.writeFileSync(java, '#!/bin/sh\necho \'openjdk version "21.0.12.1" 2026-08-18 LTS\' >&2\n');
  fs.chmodSync(java, 0o755);
  const archive = path.join(dir, 'jre.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', staging, RUNTIME_FOLDER]);
  return archive;
}

function adoptiumAsset(name: string, link: string, checksum: string | undefined): unknown {
  return {
    binary: { package: { name, link, checksum } },
    version: { semver: '21.0.12+1' },
  };
}

async function asPlatform<T>(layout: JreLayout, run: () => Promise<T>): Promise<T> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: layout.platform });
  Object.defineProperty(process, 'arch', { value: layout.arch });
  try {
    return await run();
  } finally {
    if (platform) Object.defineProperty(process, 'platform', platform);
    if (arch) Object.defineProperty(process, 'arch', arch);
  }
}

interface Provisioning {
  javaPath: Promise<string>;
  checksum: string | undefined;
  requestedApis: string[];
  downloads: { url: string; expectedSha256: string | undefined }[];
  paths: Paths;
}

function provision(dir: string, layout: JreLayout, adoptiumSendsChecksum: boolean): Provisioning {
  const archive = buildJreArchive(dir, layout);
  const checksum = adoptiumSendsChecksum
    ? crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    : undefined;
  const base = `https://example.test/OpenJDK21U-jre_${layout.adoptiumArch}_${layout.adoptiumOs}_hotspot_21.0.12.1_1`;
  const requestedApis: string[] = [];
  const downloads: Provisioning['downloads'] = [];
  const http = {
    async getJson(url: string): Promise<unknown> {
      requestedApis.push(url);
      return [
        adoptiumAsset(path.basename(`${base}.zip`), `${base}.zip`, checksum),
        adoptiumAsset(path.basename(`${base}.tar.gz`), `${base}.tar.gz`, checksum),
      ];
    },
    async download(url: string, dest: string, opts: DownloadOptions): Promise<void> {
      downloads.push({ url, expectedSha256: opts.expectedSha256 });
      fs.copyFileSync(archive, dest);
    },
  } as unknown as HttpClient;
  const detector = { detect: async () => [] } as unknown as JavaDetector;
  const paths = new Paths(path.join(dir, 'launcher'));
  const javaPath = asPlatform(layout, () =>
    new JavaProvisioner(paths, http, detector).ensure(undefined, () => {}, () => {}),
  );
  return { javaPath, checksum, requestedApis, downloads, paths };
}

async function inTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-java-'));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const layout of [LINUX_X64, MAC_ARM64]) {
  test(
    `on ${layout.platform} ${layout.arch} the Adoptium JRE tarball is downloaded, checked and extracted into a runnable java`,
    { skip: process.platform === 'win32' },
    () =>
      inTempDir(async (dir) => {
        const run = provision(dir, layout, true);

        const javaPath = await run.javaPath;

        assert.deepEqual(run.requestedApis, [
          `${ADOPTIUM_API}?architecture=${layout.adoptiumArch}&image_type=jre&os=${layout.adoptiumOs}&vendor=eclipse`,
        ]);
        assert.deepEqual(run.downloads, [
          {
            url: `https://example.test/OpenJDK21U-jre_${layout.adoptiumArch}_${layout.adoptiumOs}_hotspot_21.0.12.1_1.tar.gz`,
            expectedSha256: run.checksum,
          },
        ]);
        assert.equal(javaPath, path.join(run.paths.dataDir, 'runtime', 'jre-21', ...layout.javaDir, 'java'));
        assert.equal(fs.statSync(javaPath).mode & 0o111, 0o111);
        assert.deepEqual(fs.readdirSync(run.paths.cacheDir), []);
      }),
  );
}

test(
  'an Adoptium JRE without a SHA256 checksum is never downloaded',
  { skip: process.platform === 'win32' },
  () =>
    inTempDir(async (dir) => {
      const run = provision(dir, LINUX_X64, false);

      await assert.rejects(run.javaPath, /n'a pas fourni de somme de contrôle SHA256/);
      assert.deepEqual(run.downloads, []);
    }),
);
