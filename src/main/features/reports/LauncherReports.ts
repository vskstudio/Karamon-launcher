import type { Config } from '../config/Config';
import type { HttpClient } from '../../shared/HttpClient';
import type { JavaDetector } from '../java/JavaDetector';
import { KARAMON } from '../../shared/KaramonProfile';
import type { PackManifest } from '../modpack/PackManifest';
import { ReportCollector } from './ReportCollector';
import { ReportManager } from './ReportManager';
import { ReportQueue } from './ReportQueue';
import { ReportTransport } from './ReportTransport';
import type { ReportConsentRequest } from './ReportTypes';

const PACK_VERSION_WAIT_MS = 3000;

export interface LauncherReportsOptions {
  dataDir: string;
  http: Pick<HttpClient, 'post'>;
  launcherVersion: string;
  bundledPackVersion: string;
  packManifest: Pick<PackManifest, 'latest'>;
  config: Pick<Config, 'get' | 'set'>;
  javas: Pick<JavaDetector, 'versionInUse'>;
  gpuLabel: () => Promise<string | undefined>;
  playerName: () => string | undefined;
  instanceDir: () => string;
  requestConsent: (request: ReportConsentRequest) => void;
  announce: (message: string) => void;
  log: (message: string) => void;
}

export function createLauncherReports(options: LauncherReportsOptions): ReportManager {
  const { config, packManifest } = options;
  const collector = new ReportCollector({
    dataDir: options.dataDir,
    launcherVersion: options.launcherVersion,
    bundledPackVersion: options.bundledPackVersion,
    getPackVersion: () =>
      Promise.race([
        packManifest.latest().then((pack) => pack?.version),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PACK_VERSION_WAIT_MS).unref()),
      ]),
    getJavaVersion: () => options.javas.versionInUse(config.get().javaPath, KARAMON.javaMajor),
    getGpu: options.gpuLabel,
    getPlayerName: options.playerName,
  });
  return new ReportManager({
    collector,
    queue: new ReportQueue(options.dataDir),
    transport: new ReportTransport(options.http),
    context: () => ({ gameDir: options.instanceDir(), ramMb: config.get().memoryMb }),
    autoSend: () => config.get().autoSendReports,
    setAutoSend: (value) => config.set({ autoSendReports: value }),
    requestConsent: options.requestConsent,
    announce: options.announce,
    log: options.log,
  });
}
