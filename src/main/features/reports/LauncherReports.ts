import type { Config } from '../config/Config.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import type { JavaDetector } from '../java/JavaDetector.ts';
import { KARAMON } from '../../../shared/Karamon.ts';
import type { PackManifest } from '../modpack/PackManifest.ts';
import { ReportCollector } from './ReportCollector.ts';
import { ReportManager } from './ReportManager.ts';
import { ReportQueue } from './ReportQueue.ts';
import { ReportTransport } from './ReportTransport.ts';
import type { ReportConsentRequest } from './ReportTypes.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

const PACK_VERSION_WAIT_MS = 3000;

export interface LauncherReportsOptions {
  launcherLog: string;
  reportsDir: string;
  http: Pick<HttpClient, 'post'>;
  launcherVersion: string;
  bundledPackVersion: string;
  packManifest: Pick<PackManifest, 'latest'>;
  config: Pick<Config, 'get' | 'set'>;
  javas: Pick<JavaDetector, 'versionInUse'>;
  gpuLabel: () => Promise<string | undefined>;
  playerName: () => string | undefined;
  instance: () => GameInstance;
  requestConsent: (request: ReportConsentRequest) => void;
  announce: (message: string) => void;
  log: (message: string) => void;
}

export function createLauncherReports(options: LauncherReportsOptions): ReportManager {
  const { config, packManifest } = options;
  const collector = new ReportCollector({
    launcherLog: options.launcherLog,
    launcherVersion: options.launcherVersion,
    bundledPackVersion: options.bundledPackVersion,
    getPackVersion: () => packManifest.latest({ totalTimeoutMs: PACK_VERSION_WAIT_MS }).then((pack) => pack?.version),
    getJavaVersion: () => options.javas.versionInUse(config.get().javaPath, KARAMON.javaMajor),
    getGpu: options.gpuLabel,
    getPlayerName: options.playerName,
  });
  return new ReportManager({
    collector,
    queue: new ReportQueue(options.reportsDir),
    transport: new ReportTransport(options.http),
    context: () => ({ instance: options.instance(), ramMb: config.get().memoryMb }),
    autoSend: () => config.get().autoSendReports,
    setAutoSend: (value) => config.set({ autoSendReports: value }),
    requestConsent: options.requestConsent,
    announce: options.announce,
    log: options.log,
  });
}
