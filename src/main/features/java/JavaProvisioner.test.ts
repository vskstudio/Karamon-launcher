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
const TAR_LINK = 'https://example.test/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz';
const ZIP_LINK = 'https://example.test/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.zip';

function buildLinuxJreArchive(dir: string): string {
  const staging = path.join(dir, 'staging');
  const bin = path.join(staging, RUNTIME_FOLDER, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const java = path.join(bin, 'java');
  fs.writeFileSync(java, '#!/bin/sh\necho \'openjdk version "21.0.12.1" 2026-08-18 LTS\' >&2\n');
  fs.chmodSync(java, 0o755);
  const archive = path.join(dir, 'jre.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', staging, RUNTIME_FOLDER]);
  return archive;
}

function adoptiumAsset(name: string, link: string, checksum: string): unknown {
  return {
    binary: { package: { name, link, checksum } },
    version: { semver: '21.0.12+1' },
  };
}

test(
  'on Linux x64 the Adoptium JRE tarball is downloaded, checked and extracted into a runnable java',
  { skip: process.platform !== 'linux' || process.arch !== 'x64' },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-java-'));
    const archive = buildLinuxJreArchive(dir);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const requestedApis: string[] = [];
    const downloads: { url: string; expectedSha256: string | undefined }[] = [];
    const http = {
      async getJson(url: string): Promise<unknown> {
        requestedApis.push(url);
        return [
          adoptiumAsset(path.basename(ZIP_LINK), ZIP_LINK, checksum),
          adoptiumAsset(path.basename(TAR_LINK), TAR_LINK, checksum),
        ];
      },
      async download(url: string, dest: string, opts: DownloadOptions): Promise<void> {
        downloads.push({ url, expectedSha256: opts.expectedSha256 });
        fs.copyFileSync(archive, dest);
      },
    } as unknown as HttpClient;
    const detector = { detect: async () => [] } as unknown as JavaDetector;
    const paths = new Paths(path.join(dir, 'launcher'));

    const javaPath = await new JavaProvisioner(paths, http, detector).ensure(undefined, () => {}, () => {});

    assert.deepEqual(requestedApis, [
      'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse',
    ]);
    assert.deepEqual(downloads, [{ url: TAR_LINK, expectedSha256: checksum }]);
    assert.equal(javaPath, path.join(paths.dataDir, 'runtime', 'jre-21', RUNTIME_FOLDER, 'bin', 'java'));
    assert.equal(fs.statSync(javaPath).mode & 0o111, 0o111);
    assert.deepEqual(fs.readdirSync(paths.cacheDir), []);
  },
);
