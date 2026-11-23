import type { Config } from '../config/Config';
import type { InstalledJavas } from '../java/InstalledJavas';
import type { PackManifest } from '../modpack/PackManifest';
import { ReportCollector } from './ReportCollector';
import { ReportManager } from './ReportManager';
import { ReportQueue } from './ReportQueue';
import { ReportTransport } from './ReportTransport';
import type { ReportConsentRequest } from './ReportTypes';

const PACK_VERSION_WAIT_MS = 3000;

export interface LauncherReportsOptions {
  dataDir: string;
  launcherVersion: string;
  bundledPackVersion: string;
  packManifest: Pick<PackManifest, 'latest'>;
  config: Pick<Config, 'get' | 'set'>;
  javas: Pick<InstalledJavas, 'versionFor'>;
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
    getJavaVersion: () => options.javas.versionFor(config.get().javaPath),
    getGpu: options.gpuLabel,
    getPlayerName: options.playerName,
  });
  return new ReportManager({
    collector,
    queue: new ReportQueue(options.dataDir),
    transport: new ReportTransport(),
    context: () => ({ gameDir: options.instanceDir(), ramMb: config.get().memoryMb }),
    autoSend: () => config.get().autoSendReports,
    setAutoSend: (value) => config.set({ autoSendReports: value }),
    requestConsent: options.requestConsent,
    announce: options.announce,
    log: options.log,
  });
}
