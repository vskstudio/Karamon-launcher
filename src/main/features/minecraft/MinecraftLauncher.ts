import { DevMode } from '../../shared/DevMode';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AppConfig } from '../../../ipc/contract';
import {
  ModpackSync,
  type StatusEmitter,
  type ProgressEmitter,
} from '../modpack/ModpackSync';
import { repairCorruptConfigs, repairMessage, type ConfigRepairResult } from '../integrity/ConfigRepair';
import { detectCorruption, isEarlyCrash, readCrashEvidence } from '../integrity/CrashDiagnosis';
import { ServersDat } from './ServersDat';
import { PotatoMode, potatoSummary, type PotatoReport } from '../potato/PotatoMode';
import { potatoJvmArgs, potatoMemoryMb } from '../potato/PotatoSettings';
import { SodiumOff, sodiumSummary } from '../sodium/SodiumOff';
import type { ParkingReport } from '../modpack/JarParking';
import type { GameLauncher } from './GameLauncher';
import type { JavaProvisioner } from '../java/JavaProvisioner';

export interface MinecraftLauncherOptions {
  mcLauncherDir: string;
  defaultInstanceDir: string;
  downloadsBaseUrl: string;
  defaultHost: string;
  profileName: string;
  modpackSync: ModpackSync;
  serversDatFactory: (dir: string) => ServersDat;
  gameLauncher: GameLauncher;
  javaProvisioner: JavaProvisioner;
}

export interface LaunchEvents {
  onStatus: StatusEmitter;
  onProgress: ProgressEmitter;
  onLog: (line: string) => void;
  /** `corruption`: reasons a startup crash points at damaged files (empty otherwise). */
  onExit: (code: number | null, corruption: string[]) => void;
}

export interface RepairReport {
  /** Pack files found damaged and reinstalled. */
  damaged: string[];
  configs: ConfigRepairResult;
}

export type ServerListSetupResult =
  | { ok: true; dir: string }
  | { ok: false; dir: string; error: string };

export class MinecraftLauncher {
  private readonly mcLauncherDir: string;
  private readonly defaultInstanceDir: string;
  private readonly downloadsBaseUrl: string;
  private readonly defaultHost: string;
  private readonly profileName: string;
  private readonly modpackSync: ModpackSync;
  private readonly serversDatFactory: (dir: string) => ServersDat;
  private readonly gameLauncher: GameLauncher;
  private readonly javaProvisioner: JavaProvisioner;

  constructor({
    mcLauncherDir,
    defaultInstanceDir,
    downloadsBaseUrl,
    defaultHost,
    profileName,
    modpackSync,
    serversDatFactory,
    gameLauncher,
    javaProvisioner,
  }: MinecraftLauncherOptions) {
    this.mcLauncherDir = mcLauncherDir;
    this.defaultInstanceDir = defaultInstanceDir;
    this.downloadsBaseUrl = downloadsBaseUrl;
    this.defaultHost = defaultHost;
    this.profileName = profileName;
    this.modpackSync = modpackSync;
    this.serversDatFactory = serversDatFactory;
    this.gameLauncher = gameLauncher;
    this.javaProvisioner = javaProvisioner;
  }

  instanceDir(config: AppConfig): string {
    return config.mcGameDir || this.defaultInstanceDir;
  }

  isRunning(): boolean {
    return this.gameLauncher.isRunning();
  }

  ensureServerLists(gameDir: string, host: string, name: string, devMode = false): ServerListSetupResult[] {
    return this.serverListDirs(gameDir).map((dir) => {
      try {
        const servers = this.serversDatFactory(dir);
        servers.ensureServer(host, name, devMode);
        // Dev mode: a ready entry for a server running on this machine.
        if (devMode) servers.ensureServer('localhost', `${name} (local)`, true);
        return { ok: true, dir };
      } catch (e) {
        return { ok: false, dir, error: (e as Error).message };
      }
    });
  }

  async launch(config: AppConfig, events: LaunchEvents): Promise<void> {
    const gameDir = this.instanceDir(config);
    this.prepareGameDir(gameDir, config, events.onStatus);

    const javaPath = await this.javaProvisioner.ensure(
      config.javaPath,
      events.onStatus,
      (p) => events.onProgress(p * 0.1),
    );

    events.onStatus('Synchronisation du pack...');
    this.beforeSync(gameDir, config, events.onStatus);
    await this.modpackSync.sync(
      this.downloadsBaseUrl,
      gameDir,
      events.onStatus,
      (p) => events.onProgress(0.1 + p * 0.25),
    );
    this.repairConfigs(gameDir, events.onStatus);
    this.afterSync(gameDir, config, events.onStatus);
    const jvm = MinecraftLauncher.jvmSettings(config, os.totalmem() / 1024 / 1024);
    if (jvm.memoryMb < config.memoryMb) {
      events.onStatus(
        `Mode PC modeste : le jeu démarre avec ${MinecraftLauncher.go(jvm.memoryMb)} de mémoire (réglage : ${MinecraftLauncher.go(config.memoryMb)}).`,
      );
    }

    let spawnedAt = Date.now();
    await this.gameLauncher.launch(
      {
        javaPath,
        memoryMb: jvm.memoryMb,
        jvmArgs: jvm.jvmArgs,
        gameDir,
        devMode: DevMode.enabled(config.devMode),
      },
      {
        onStatus: events.onStatus,
        onProgress: (p) => events.onProgress(0.35 + p * 0.65),
        onLog: events.onLog,
        onExit: (code) => {
          const corruption = isEarlyCrash(code, spawnedAt, Date.now())
            ? detectCorruption(readCrashEvidence(gameDir, spawnedAt))
            : [];
          events.onExit(code, corruption);
        },
      },
    );
    spawnedAt = Date.now();
  }

  async syncOnly(
    config: AppConfig,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<void> {
    const gameDir = this.instanceDir(config);
    this.prepareGameDir(gameDir, config, onStatus);
    this.beforeSync(gameDir, config, onStatus);
    await this.modpackSync.sync(this.downloadsBaseUrl, gameDir, onStatus, onProgress);
    this.afterSync(gameDir, config, onStatus);
  }

  /** Full verification: rehash every pack file, reinstall the damaged ones, repair configs. */
  async repair(
    config: AppConfig,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<RepairReport> {
    if (this.isRunning()) throw new Error("Ferme Minecraft avant de réparer l'installation.");
    const gameDir = this.instanceDir(config);
    this.prepareGameDir(gameDir, config, onStatus);
    this.beforeSync(gameDir, config, onStatus);
    const sync = await this.modpackSync.sync(this.downloadsBaseUrl, gameDir, onStatus, onProgress, {
      verifyAll: true,
    });
    const configs = this.repairConfigs(gameDir, onStatus);
    this.afterSync(gameDir, config, onStatus);
    return { damaged: sync.damaged, configs };
  }

  /**
   * Applies the mode PC modeste to the game folder right away (mode on) or puts
   * back what it changed (mode off). Not while the game runs: its jars are open.
   */
  applyPotatoMode(config: AppConfig, onStatus: StatusEmitter): void {
    if (this.isRunning()) {
      onStatus('Mode PC modeste : appliqué au prochain lancement du jeu.');
      return;
    }
    const gameDir = this.instanceDir(config);
    const report = PotatoMode.reconcile(gameDir, config.potatoMode);
    MinecraftLauncher.reportPotato(config.potatoMode, report, onStatus, true);
  }

  applySodiumOff(config: AppConfig, onStatus: StatusEmitter): void {
    if (this.isRunning()) {
      onStatus('Désactiver Sodium : appliqué au prochain lancement du jeu.');
      return;
    }
    const report = SodiumOff.reconcile(this.instanceDir(config), config.disableSodium);
    MinecraftLauncher.reportSodium(config.disableSodium, report, onStatus, true);
  }

  /** Heap and JVM arguments the game starts with. The mode only lowers the heap and adds GC flags. */
  static jvmSettings(config: AppConfig, totalMemMb: number): { memoryMb: number; jvmArgs: string } {
    if (!config.potatoMode) return { memoryMb: config.memoryMb, jvmArgs: config.jvmArgs };
    return {
      memoryMb: potatoMemoryMb(totalMemMb, config.memoryMb),
      jvmArgs: [...potatoJvmArgs(config.jvmArgs), config.jvmArgs.trim()].filter(Boolean).join(' '),
    };
  }

  /** Mode off: the parked mods and settings come back before the sync verifies the pack. */
  private potatoBeforeSync(gameDir: string, config: AppConfig, onStatus: StatusEmitter): void {
    if (config.potatoMode) return;
    MinecraftLauncher.reportPotato(false, PotatoMode.restore(gameDir), onStatus);
  }

  /** Mode on: after the sync (which may rewrite iris.properties or add a jar), lower everything again. */
  private potatoAfterSync(gameDir: string, config: AppConfig, onStatus: StatusEmitter): void {
    if (!config.potatoMode) return;
    MinecraftLauncher.reportPotato(true, PotatoMode.apply(gameDir), onStatus);
  }

  private beforeSync(gameDir: string, config: AppConfig, onStatus: StatusEmitter): void {
    this.potatoBeforeSync(gameDir, config, onStatus);
    if (!config.disableSodium) MinecraftLauncher.reportSodium(false, SodiumOff.restore(gameDir), onStatus);
  }

  private afterSync(gameDir: string, config: AppConfig, onStatus: StatusEmitter): void {
    this.potatoAfterSync(gameDir, config, onStatus);
    if (config.disableSodium) MinecraftLauncher.reportSodium(true, SodiumOff.apply(gameDir), onStatus);
  }

  private static reportSodium(disabled: boolean, report: ParkingReport, onStatus: StatusEmitter, always = false): void {
    if (always || report.mods.length > 0) onStatus(sodiumSummary(disabled, report));
    for (const error of report.errors) onStatus(`Désactiver Sodium, fichier ignoré : ${error}`);
  }

  private static reportPotato(
    enabled: boolean,
    report: PotatoReport,
    onStatus: StatusEmitter,
    always = enabled,
  ): void {
    if (always || report.settings.length > 0 || report.mods.length > 0) onStatus(potatoSummary(enabled, report));
    for (const error of report.errors) onStatus(`Mode PC modeste, fichier ignoré : ${error}`);
  }

  private static go(mb: number): string {
    return `${(mb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
  }

  private repairConfigs(gameDir: string, onStatus: StatusEmitter): ConfigRepairResult {
    const result = repairCorruptConfigs(gameDir, ModpackSync.overridesArchive(gameDir));
    if (result.repaired.length > 0 && result.backupDir) {
      onStatus(`${repairMessage(result.repaired.length)} Copies abîmées: ${path.basename(result.backupDir)}/`);
    }
    return result;
  }

  private prepareGameDir(gameDir: string, config: AppConfig, onStatus: StatusEmitter): void {
    fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
    const host = config.server?.host || this.defaultHost;
    const dev = DevMode.enabled(config.devMode);
    for (const result of this.ensureServerLists(gameDir, host, this.profileName, dev)) {
      if (!result.ok) {
        onStatus(`Avertissement servers.dat (${result.dir}): ${result.error}`);
      }
    }
  }

  private serverListDirs(gameDir: string): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();
    for (const dir of [gameDir, this.mcLauncherDir]) {
      const key = path.resolve(dir).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dirs.push(dir);
    }
    return dirs;
  }
}
