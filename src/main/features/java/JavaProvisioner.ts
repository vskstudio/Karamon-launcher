import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { HttpClient } from '../../shared/HttpClient.ts';
import type { Paths } from '../../shared/Paths.ts';
import { extractZipToDir } from '../../shared/ZipExtract.ts';
import { KARAMON } from '../../shared/KaramonProfile.ts';
import type { JavaDetector } from './JavaDetector.ts';
import { javaExecutableName, javaExecutablesUnder, probeJava } from './JavaRuntime.ts';

const execFileP = promisify(execFile);

const REQUIRED_MAJOR = KARAMON.javaMajor;
const REQUIRED_JAVA = `Java ${REQUIRED_MAJOR}`;
const ADOPTIUM_DOWNLOAD_RESPONSE_TIMEOUT_MS = 600000;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

type ArchiveExt = '.zip' | '.tar.gz';

interface AdoptiumPlatform {
  os: string;
  archiveExt: ArchiveExt;
}

const ADOPTIUM_PLATFORMS: Partial<Record<NodeJS.Platform, AdoptiumPlatform>> = {
  win32: { os: 'windows', archiveExt: '.zip' },
  linux: { os: 'linux', archiveExt: '.tar.gz' },
  darwin: { os: 'mac', archiveExt: '.tar.gz' },
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

export function managedJavaRuntimeRoot(paths: Paths): string {
  return path.join(paths.dataDir, 'runtime', `jre-${REQUIRED_MAJOR}`);
}

async function majorOf(javaPath: string): Promise<number | null> {
  return (await probeJava(javaPath))?.major ?? null;
}

export class JavaProvisioner {
  private readonly paths: Paths;
  private readonly http: HttpClient;
  private readonly detector: Pick<JavaDetector, 'detect' | 'invalidate'>;

  constructor(paths: Paths, http: HttpClient, detector: Pick<JavaDetector, 'detect' | 'invalidate'>) {
    this.paths = paths;
    this.http = http;
    this.detector = detector;
  }

  async ensure(
    configuredPath: string | undefined,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<string> {
    if (configuredPath && (await majorOf(configuredPath)) === REQUIRED_MAJOR) return configuredPath;

    const managed = this.managedJavaPath();
    if (managed && (await majorOf(managed)) === REQUIRED_MAJOR) return managed;

    const preferred = (await this.detector.detect()).find((install) => install.major === REQUIRED_MAJOR);
    if (preferred) return preferred.path;

    const platform = ADOPTIUM_PLATFORMS[process.platform];
    if (!platform) {
      throw new Error(`${REQUIRED_JAVA} requis et non détecté. Installe-le depuis adoptium.net puis relance le launcher.`);
    }

    const installed = await this.installAdoptium(platform, onStatus, onProgress);
    this.detector.invalidate();
    return installed;
  }

  private async installAdoptium(
    platform: AdoptiumPlatform,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<string> {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const apiUrl =
      `https://api.adoptium.net/v3/assets/latest/${REQUIRED_MAJOR}/hotspot` +
      `?architecture=${arch}&image_type=jre&os=${platform.os}&vendor=eclipse`;

    onStatus(`Recherche de ${REQUIRED_JAVA} (Adoptium Temurin)...`);
    const assets = await this.http.getJson<AdoptiumAsset[]>(apiUrl);
    const asset = JavaProvisioner.pickArchiveAsset(assets, platform.archiveExt);
    if (!asset) {
      throw new Error(`Aucune archive ${REQUIRED_JAVA} disponible chez Adoptium pour cette architecture.`);
    }

    const versionLabel = asset.version.semver ?? asset.version.openjdk_version ?? 'inconnu';
    onStatus(`Téléchargement de ${REQUIRED_JAVA} (${versionLabel}, ~45 Mo)...`);

    const checksum = asset.binary.package.checksum;
    if (!SHA256_HEX.test(checksum ?? '')) {
      throw new Error("Adoptium n'a pas fourni de somme de contrôle SHA256 : téléchargement refusé.");
    }

    const cacheDir = this.paths.cacheDir;
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpArchive = path.join(cacheDir, path.basename(asset.binary.package.name));

    await this.http.download(asset.binary.package.link, tmpArchive, {
      label: REQUIRED_JAVA,
      responseTimeoutMs: ADOPTIUM_DOWNLOAD_RESPONSE_TIMEOUT_MS,
      expectedSha256: checksum,
      onProgress,
    });

    onStatus(`Extraction de ${REQUIRED_JAVA}...`);
    await this.extractRuntime(tmpArchive, platform.archiveExt);
    fs.rmSync(tmpArchive, { force: true });

    const javaPath = this.managedJavaPath();
    if (!javaPath) {
      throw new Error(`Extraction terminée mais ${javaExecutableName()} introuvable dans le runtime.`);
    }
    const major = await majorOf(javaPath);
    if (major !== REQUIRED_MAJOR) {
      throw new Error(`Le runtime extrait n'est pas ${REQUIRED_JAVA} (détecté: ${major ?? '?'}).`);
    }
    onStatus(`${REQUIRED_JAVA} prêt.`);
    return javaPath;
  }

  private async extractRuntime(archivePath: string, archiveExt: ArchiveExt): Promise<void> {
    const root = this.runtimeRoot();
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    fs.mkdirSync(root, { recursive: true });
    if (archiveExt === '.tar.gz') {
      await execFileP('tar', ['-xzf', archivePath, '-C', root]);
      return;
    }
    await extractZipToDir(archivePath, root);
  }

  private runtimeRoot(): string {
    return managedJavaRuntimeRoot(this.paths);
  }

  private managedJavaPath(): string | null {
    return javaExecutablesUnder(this.runtimeRoot())[0] ?? null;
  }

  private static pickArchiveAsset(
    assets: AdoptiumAsset[] | null | undefined,
    archiveExt: ArchiveExt,
  ): AdoptiumAsset | null {
    if (!Array.isArray(assets) || assets.length === 0) return null;
    return assets.find((a) => a.binary.package.name?.toLowerCase().endsWith(archiveExt)) ?? null;
  }
}
