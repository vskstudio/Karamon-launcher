import type { Config } from '../config/Config';
import type { CrashReports } from '../crashes/CrashReports';
import type { DiscordRpc } from '../discord/DiscordRpc';
import { repairSummary } from '../integrity/RepairSummary';
import type { MinecraftLauncher } from '../minecraft/MinecraftLauncher';
import type { ProgressEmitter, StatusEmitter } from '../modpack/ModpackSync';
import type { PackManifest, RemotePack } from '../modpack/PackManifest';
import type { ReportManager } from '../reports/ReportManager';
import { failureSummary, failureTrigger } from '../reports/ReportTriggers';
import type { PlayStats } from '../stats/PlayStats';
import type { AutoUpdater } from '../updater/AutoUpdater';

const CLOSE_DELAY_MS = 2000;

export interface GameState {
  running: boolean;
}

export interface RepairDone {
  summary: string;
  damaged: number;
  configs: number;
}

export type RepairResult = ({ ok: true } & RepairDone) | { ok: false; error: string };

export interface RepairOffer {
  reasons: string[];
  result: RepairResult;
}

export interface PlayEvents {
  consoleLine(line: string): void;
  gameState(state: GameState): void;
  repairOffer(offer: RepairOffer): void;
}

export interface PlayActionsOptions {
  config: Pick<Config, 'get'>;
  minecraft: MinecraftLauncher;
  packManifest: PackManifest;
  stats: PlayStats;
  discord: DiscordRpc;
  updater: AutoUpdater;
  crashes: CrashReports;
  reports: Pick<ReportManager, 'reportInBackground'>;
  events: PlayEvents;
  closeWindow: () => void;
  status: StatusEmitter;
  progress: ProgressEmitter;
  log: (message: string) => void;
}

export class PlayActions {
  private readonly options: PlayActionsOptions;
  private repairing: Promise<RepairDone> | null = null;

  constructor(options: PlayActionsOptions) {
    this.options = options;
  }

  async play(): Promise<void> {
    const { config, minecraft, packManifest, stats, discord, events, status, progress, reports } = this.options;
    const startedAt = Date.now();
    const cfg = config.get();
    const wasRunning = minecraft.isRunning();
    const gameDir = minecraft.instanceDir(cfg);
    const publishedPack = packManifest.latest();
    try {
      progress(0);
      await minecraft.launch(cfg, {
        onStatus: status,
        onProgress: progress,
        onLog: (line) => events.consoleLine(line),
        onExit: (code, corruption, trigger) => {
          this.options.log(`Minecraft fermé (code ${code})${corruption.length ? `, corruption: ${corruption.join(', ')}` : ''}`);
          if (!minecraft.isRunning()) {
            this.setGameRunning(false);
            stats.endSession();
            discord.setMenu();
            events.gameState({ running: false });
          }
          events.consoleLine(code === 0 ? 'Minecraft fermé.' : `Minecraft fermé (code ${code}).`);
          if (corruption.length > 0) void this.repairAfterCrash(corruption);
          if (trigger) {
            reports.reportInBackground(
              trigger,
              [`Code de sortie ${code}`, ...corruption, ...this.options.crashes.recentCrashCause(gameDir)],
              startedAt,
            );
          }
        },
      });
      if (!wasRunning) {
        stats.startSession();
        void this.recordInstalledPack(gameDir, publishedPack);
      }
      discord.setPlaying();
      this.setGameRunning(true);
      events.gameState({ running: true });
      status('Minecraft lancé !');
      if (cfg.closeLauncherOnGameStart) setTimeout(() => this.options.closeWindow(), CLOSE_DELAY_MS);
    } catch (e) {
      status('Erreur: ' + (e as Error).message);
      progress(0);
      if (!minecraft.isRunning()) events.gameState({ running: false });
      reports.reportInBackground(failureTrigger(e), failureSummary(e), startedAt);
      throw e;
    }
  }

  async syncMods(): Promise<void> {
    const { config, minecraft, packManifest, status, progress, reports } = this.options;
    const startedAt = Date.now();
    const cfg = config.get();
    const publishedPack = packManifest.latest();
    try {
      progress(0);
      await minecraft.syncOnly(cfg, status, progress);
      void this.recordInstalledPack(minecraft.instanceDir(cfg), publishedPack);
      progress(1);
    } catch (e) {
      const message = (e as Error).message;
      status('Erreur de synchronisation: ' + message);
      progress(0);
      reports.reportInBackground('sync_failed', ['Synchronisation du pack', message], startedAt);
      throw e;
    }
  }

  repair(): Promise<RepairDone> {
    if (!this.repairing) {
      this.repairing = this.runRepair().finally(() => {
        this.repairing = null;
      });
    }
    return this.repairing;
  }

  private async runRepair(): Promise<RepairDone> {
    const { config, minecraft, packManifest, status, progress } = this.options;
    const cfg = config.get();
    try {
      progress(0);
      status("Réparation de l'installation : vérification complète...");
      const publishedPack = packManifest.latest();
      const report = await minecraft.repair(cfg, status, progress);
      void this.recordInstalledPack(minecraft.instanceDir(cfg), publishedPack);
      const damaged = report.damaged.length;
      const configs = report.configs.repaired.length;
      const summary = repairSummary(damaged, configs);
      progress(1);
      status(summary);
      return { summary, damaged, configs };
    } catch (e) {
      status('Erreur de réparation: ' + (e as Error).message);
      progress(0);
      throw e;
    }
  }

  private async repairAfterCrash(reasons: string[]): Promise<void> {
    const { events } = this.options;
    events.consoleLine(
      `Le jeu a planté au démarrage sur des fichiers abîmés (${reasons.join(', ')}). Réparation automatique...`,
    );
    const result: RepairResult = await this.repair().then(
      (done) => ({ ok: true as const, ...done }),
      (e: unknown) => ({ ok: false as const, error: (e as Error).message }),
    );
    events.repairOffer({ reasons, result });
  }

  private setGameRunning(running: boolean): void {
    this.options.updater.setPaused(running);
    this.options.discord.setPingPaused(running);
  }

  private async recordInstalledPack(gameDir: string, publishedPack: Promise<RemotePack | null>): Promise<void> {
    const pack = await publishedPack;
    if (pack) this.options.packManifest.markInstalled(gameDir, pack.version);
  }
}
