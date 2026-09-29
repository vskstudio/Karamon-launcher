import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { HttpClient } from '../../shared/HttpClient.ts';
import type { Paths } from '../../shared/Paths.ts';
import { extractZipToDir } from '../../shared/ZipExtract.ts';
import type { JavaDetector } from './JavaDetector.ts';

const execFileP = promisify(execFile);

const REQUIRED_MAJOR = 21;
const RUNTIME_DIR_NAME = 'jre-21';
const ADOPTIUM_DOWNLOAD_TIMEOUT_MS = 600000;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

const ADOPTIUM_PLATFORMS: Partial<Record<NodeJS.Platform, { os: string; archiveExt: string }>> = {
  win32: { os: 'windows', archiveExt: '.zip' },
  linux: { os: 'linux', archiveExt: '.tar.gz' },
};

interface AdoptiumPackage {
  link: string;
  name: string;
  checksum?: string;
}

interface AdoptiumBinary {
  package: AdoptiumPackage;
}

interface AdoptiumAsset {
  binary: AdoptiumBinary;
  version: { semver?: string; openjdk_version?: string };
}

export type StatusEmitter = (msg: string) => void;
export type ProgressEmitter = (fraction: number) => void;

export class JavaProvisioner {
  private readonly paths: Paths;
  private readonly http: HttpClient;
  private readonly detector: JavaDetector;

  constructor(paths: Paths, http: HttpClient, detector: JavaDetector) {
    this.paths = paths;
    this.http = http;
    this.detector = detector;
  }

  async ensure(
    configuredPath: string | undefined,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<string> {
    if (configuredPath) {
      const major = await this.probeMajor(configuredPath);
      if (major !== null && major >= REQUIRED_MAJOR) return configuredPath;
    }

    const managed = this.managedJavaPath();
    if (managed) {
      const major = await this.probeMajor(managed);
      if (major !== null && major >= REQUIRED_MAJOR) return managed;
    }

    const detected = await this.detector.detect();
    const preferred = detected.find(
      (c) => JavaProvisioner.parseMajor(c.version) === REQUIRED_MAJOR,
    );
    if (preferred) return preferred.path;
    const compatible = detected.find(
      (c) => JavaProvisioner.parseMajor(c.version) >= REQUIRED_MAJOR,
    );
    if (compatible) return compatible.path;

    const platform = ADOPTIUM_PLATFORMS[process.platform];
    if (!platform) {
      throw new Error(
        `Java ${REQUIRED_MAJOR} requis et non détecté. Installe-le depuis adoptium.net puis relance le launcher.`,
      );
    }

    return await this.installAdoptium(platform, onStatus, onProgress);
  }

  private async installAdoptium(
    platform: { os: string; archiveExt: string },
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<string> {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const apiUrl =
      `https://api.adoptium.net/v3/assets/latest/${REQUIRED_MAJOR}/hotspot` +
      `?architecture=${arch}&image_type=jre&os=${platform.os}&vendor=eclipse`;

    onStatus('Recherche de Java 21 (Adoptium Temurin)...');
    const assets = await this.http.getJson<AdoptiumAsset[]>(apiUrl);
    const asset = JavaProvisioner.pickArchiveAsset(assets, platform.archiveExt);
    if (!asset) {
      throw new Error('Aucune archive Java 21 disponible chez Adoptium pour cette architecture.');
    }

    const versionLabel = asset.version.semver ?? asset.version.openjdk_version ?? 'inconnu';
    onStatus(`Téléchargement de Java 21 (${versionLabel}, ~45 Mo)...`);

    const checksum = asset.binary.package.checksum;
    if (!SHA256_HEX.test(checksum ?? '')) {
      throw new Error("Adoptium n'a pas fourni de somme de contrôle SHA256 : téléchargement refusé.");
    }

    const cacheDir = this.paths.cacheDir;
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpArchive = path.join(cacheDir, path.basename(asset.binary.package.name));

    await this.http.download(asset.binary.package.link, tmpArchive, {
      label: 'Java 21',
      timeoutMs: ADOPTIUM_DOWNLOAD_TIMEOUT_MS,
      expectedSha256: checksum,
      onProgress,
    });

    onStatus('Extraction de Java 21...');
    await this.extractRuntime(tmpArchive);
    fs.rmSync(tmpArchive, { force: true });

    const javaPath = this.managedJavaPath();
    if (!javaPath) {
      throw new Error(`Extraction terminée mais ${JavaProvisioner.javaExecutable()} introuvable dans le runtime.`);
    }
    const major = await this.probeMajor(javaPath);
    if (major === null || major < REQUIRED_MAJOR) {
      throw new Error(`Le runtime extrait n'est pas Java ${REQUIRED_MAJOR} (détecté: ${major ?? '?'}).`);
    }
    onStatus(`Java ${REQUIRED_MAJOR} prêt.`);
    return javaPath;
  }

  private async extractRuntime(archivePath: string): Promise<void> {
    const root = this.runtimeRoot();
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    fs.mkdirSync(root, { recursive: true });
    if (archivePath.toLowerCase().endsWith('.tar.gz')) {
      await execFileP('tar', ['-xzf', archivePath, '-C', root]);
      return;
    }
    extractZipToDir(archivePath, root);
  }

  private static javaExecutable(): string {
    return process.platform === 'win32' ? 'java.exe' : 'java';
  }

  private runtimeRoot(): string {
    return path.join(this.paths.dataDir, 'runtime', RUNTIME_DIR_NAME);
  }

  private managedJavaPath(): string | null {
    const root = this.runtimeRoot();
    if (!fs.existsSync(root)) return null;
    const exe = JavaProvisioner.javaExecutable();
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const candidates = [
        path.join(root, entry, 'bin', exe),
        path.join(root, entry, 'Contents', 'Home', 'bin', exe),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    return null;
  }

  private async probeMajor(javaPath: string): Promise<number | null> {
    try {
      const { stderr, stdout } = await execFileP(javaPath, ['-version'], { timeout: 4000 });
      const text = stderr || stdout || '';
      const m = text.match(/version "([^"]+)"/);
      if (!m) return null;
      return JavaProvisioner.parseMajor(m[1]);
    } catch {
      return null;
    }
  }

  private static pickArchiveAsset(
    assets: AdoptiumAsset[] | null | undefined,
    archiveExt: string,
  ): AdoptiumAsset | null {
    if (!Array.isArray(assets) || assets.length === 0) return null;
    return assets.find((a) => a.binary.package.name?.toLowerCase().endsWith(archiveExt)) ?? null;
  }

  static parseMajor(version: string): number {
    if (!version) return 0;
    const m = version.match(/^(\d+)/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (n === 1) {
      const second = version.match(/^1\.(\d+)/);
      return second ? parseInt(second[1], 10) : 0;
    }
    return n;
  }
}
