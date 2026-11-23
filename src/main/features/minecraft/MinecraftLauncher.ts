import fs from 'fs';
import os from 'os';
import path from 'path';
import { DevMode } from '../../shared/DevMode.ts';
import { GameInstance, type InstalledMod } from '../../shared/GameInstance.ts';
import type { AppConfig } from '../config/Config.ts';
import type { ModpackSync, StatusEmitter, ProgressEmitter } from '../modpack/ModpackSync.ts';
import { installedPackJars } from '../modpack/InstalledPack.ts';
import { repairCorruptConfigs, repairMessage, type ConfigRepairResult } from '../integrity/ConfigRepair.ts';
import { detectCorruption, isEarlyCrash, readCrashEvidence, stoppedCleanly } from '../integrity/CrashDiagnosis.ts';
import { ModToggles } from '../modtoggles/ModToggles.ts';
import { PACK_MIN_MEMORY_MB, potatoJvmArgs, potatoMemoryMb } from '../potato/PotatoSettings.ts';
import { LaunchPhaseError, exitTrigger, type LaunchPhase } from '../reports/ReportTriggers.ts';
import type { GameLauncher } from './GameLauncher.ts';
import { ServersDat } from './ServersDat.ts';
import type { JavaProvisioner } from '../java/JavaProvisioner.ts';
import { GameRunningError, InstanceSession } from './InstanceSession.ts';
import { ShaderPolicy } from './ShaderChoice.ts';
import { applyPackClientSettings } from './PackClientSettings.ts';
import { reconcilePlayerToggles, type ToggleTrigger } from './PlayerToggles.ts';

export { GameRunningError };

export interface MinecraftLauncherOptions {
  mcLauncherDir: string;
  defaultInstanceDir: string;
  downloadsBaseUrl: string;
  defaultHost: string;
  profileName: string;
  minecraftVersion: string;
  modpackSync: ModpackSync;
  gameLauncher: Pick<GameLauncher, 'launch'>;
  javaProvisioner: Pick<JavaProvisioner, 'ensure'>;
}

export interface LaunchEvents {
  onStatus: StatusEmitter;
  onProgress: ProgressEmitter;
  onLog: (line: string) => void;
  onExit: (code: number | null, corruption: string[], trigger: 'crash_early' | 'crash' | null) => void;
}

export interface RepairReport {
  damaged: string[];
  configs: ConfigRepairResult;
}

export type ServerListSetupResult =
  | { ok: true; dir: string }
  | { ok: false; dir: string; error: string };

const TOGGLE_LABELS: Record<Exclude<ToggleTrigger, 'sync'>, string> = {
  potato: 'Mode PC modeste',
  sodium: 'Désactiver Sodium',
};

export class MinecraftLauncher {
  private readonly opts: MinecraftLauncherOptions;
  private readonly sessions = new Map<string, InstanceSession>();

  constructor(opts: MinecraftLauncherOptions) {
    this.opts = opts;
  }

  instanceDir(config: AppConfig): string {
    return config.mcGameDir || this.opts.defaultInstanceDir;
  }

  session(config: AppConfig): InstanceSession {
    const dir = path.resolve(this.instanceDir(config));
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    let session = this.sessions.get(key);
    if (!session) {
      session = new InstanceSession(new GameInstance(dir));
      this.sessions.set(key, session);
    }
    return session;
  }

  isRunning(): boolean {
    return [...this.sessions.values()].some((session) => session.gameRunning);
  }

  listMods(config: AppConfig): { dir: string; mods: InstalledMod[] } {
    const instance = this.session(config).instance;
    return { dir: instance.modsDir, mods: instance.listMods() };
  }

  ensureServerLists(gameDir: string, host: string, name: string, devMode = false): ServerListSetupResult[] {
    return this.serverListDirs(gameDir).map((dir) => {
      try {
        const servers = new ServersDat(dir);
        servers.ensureServer(host, name, devMode);
        if (devMode) servers.ensureDevServer(name);
        return { ok: true, dir };
      } catch (e) {
        return { ok: false, dir, error: (e as Error).message };
      }
    });
  }

  async launch(config: AppConfig, events: LaunchEvents): Promise<void> {
    let phase: LaunchPhase = 'launch';
    const session = this.session(config);
    try {
      await session.exclusive(() => this.launchSteps(session, config, events, (next) => (phase = next)));
    } catch (e) {
      throw e instanceof LaunchPhaseError ? e : new LaunchPhaseError(phase, e);
    }
  }

  syncOnly(config: AppConfig, onStatus: StatusEmitter, onProgress: ProgressEmitter): Promise<void> {
    const session = this.session(config);
    return session.joined('sync', () =>
      session.whileGameClosed('Ferme Minecraft avant de synchroniser le pack.', async () => {
        this.prepareGameDir(session.instance, config, onStatus);
        await this.installPack(session.instance, config, false, onStatus, onProgress);
      }),
    );
  }

  repair(config: AppConfig, onStatus: StatusEmitter, onProgress: ProgressEmitter): Promise<RepairReport> {
    const session = this.session(config);
    return session.joined('repair', () =>
      session.whileGameClosed("Ferme Minecraft avant de réparer l'installation.", async () => {
        this.prepareGameDir(session.instance, config, onStatus);
        return this.installPack(session.instance, config, true, onStatus, onProgress);
      }),
    );
  }

  applyModToggles(before: AppConfig, after: AppConfig, onStatus: StatusEmitter, current: () => AppConfig = () => after): Promise<void> {
    const triggers = changedToggles(before, after);
    if (triggers.length === 0) return Promise.resolve();
    const session = this.session(after);
    return session.exclusive(async () => {
      const config = current();
      if (session.gameRunning) {
        for (const trigger of triggers) onStatus(`${TOGGLE_LABELS[trigger]} : appliqué au prochain lancement du jeu.`);
        return;
      }
      reconcilePlayerToggles(session.instance, config, installedPackJars(session.instance), triggers[0], onStatus);
    });
  }

  static jvmSettings(config: AppConfig, totalMemMb: number): { memoryMb: number; jvmArgs: string } {
    if (!config.potatoMode) return { memoryMb: config.memoryMb, jvmArgs: config.jvmArgs };
    return {
      memoryMb: potatoMemoryMb(totalMemMb, config.memoryMb),
      jvmArgs: [...potatoJvmArgs(config.jvmArgs), config.jvmArgs.trim()].filter(Boolean).join(' '),
    };
  }

  private async launchSteps(
    session: InstanceSession,
    config: AppConfig,
    events: LaunchEvents,
    setPhase: (phase: LaunchPhase) => void,
  ): Promise<void> {
    const { instance } = session;
    const packInUse = session.gameRunning;
    if (!packInUse) this.prepareGameDir(instance, config, events.onStatus);

    const javaPath = await this.opts.javaProvisioner.ensure(config.javaPath, events.onStatus, (p) => events.onProgress(p * 0.1));

    if (packInUse) {
      events.onStatus('Un autre Minecraft tourne déjà : le pack est lancé sans synchronisation.');
    } else {
      events.onStatus('Synchronisation du pack...');
      setPhase('sync');
      await this.installPack(instance, config, false, events.onStatus, (p) => events.onProgress(0.1 + p * 0.25));
      setPhase('launch');
    }
    const memoryMb = packInUse ? config.secondInstanceMemoryMb : config.memoryMb;
    const jvm = MinecraftLauncher.jvmSettings({ ...config, memoryMb }, os.totalmem() / 1024 / 1024);
    if (jvm.memoryMb < memoryMb) {
      events.onStatus(`Mode PC modeste : le jeu démarre avec ${go(jvm.memoryMb)} de mémoire (réglage : ${go(memoryMb)}).`);
    }
    if (jvm.memoryMb < PACK_MIN_MEMORY_MB) {
      events.onStatus(
        `Attention : avec ${go(jvm.memoryMb)} de mémoire, le pack risque de planter au chargement (il lui faut ${go(PACK_MIN_MEMORY_MB)}).`,
      );
    }

    const gameEnded = session.gameStarted();
    try {
      await this.opts.gameLauncher.launch(
        { javaPath, memoryMb: jvm.memoryMb, jvmArgs: jvm.jvmArgs, gameDir: instance.dir, devMode: DevMode.enabled(config.devMode) },
        {
          onStatus: events.onStatus,
          onProgress: (p) => events.onProgress(0.35 + p * 0.65),
          onLog: events.onLog,
          onExit: (code, spawnedAt) => {
            gameEnded();
            const endedAt = Date.now();
            const corruption = isEarlyCrash(code, spawnedAt, endedAt)
              ? detectCorruption(readCrashEvidence(instance, spawnedAt))
              : [];
            const clean = code !== 0 && stoppedCleanly(instance, spawnedAt);
            events.onExit(code, corruption, exitTrigger(code, spawnedAt, endedAt, clean));
          },
        },
      );
    } catch (e) {
      gameEnded();
      throw e;
    }
  }

  private async installPack(
    instance: GameInstance,
    config: AppConfig,
    verifyAll: boolean,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<RepairReport> {
    const shaders = new ShaderPolicy(instance);
    let packJars: Set<string>;
    let report: RepairReport;
    try {
      const result = await this.opts.modpackSync.sync({
        baseUrl: this.opts.downloadsBaseUrl,
        instance,
        parkedJars: new ModToggles(instance).parkedJars(),
        playerSettings: shaders,
        verifyAll,
        onStatus,
        onProgress,
      });
      packJars = result.packJars;
      report = { damaged: result.damaged, configs: this.repairConfigs(instance, onStatus) };
      applyPackClientSettings(instance, this.opts.minecraftVersion, result.clientOptions, shaders, onStatus);
    } finally {
      const failure = shaders.save();
      if (failure) onStatus(`Choix de shader non enregistré : ${failure}`);
    }
    reconcilePlayerToggles(instance, config, packJars, 'sync', onStatus);
    return report;
  }

  private repairConfigs(instance: GameInstance, onStatus: StatusEmitter): ConfigRepairResult {
    const result = repairCorruptConfigs(instance);
    if (result.repaired.length > 0 && result.backupDir) {
      onStatus(`${repairMessage(result.repaired.length)} Copies abîmées: ${path.basename(result.backupDir)}/`);
    }
    return result;
  }

  private prepareGameDir(instance: GameInstance, config: AppConfig, onStatus: StatusEmitter): void {
    fs.mkdirSync(instance.modsDir, { recursive: true });
    const host = config.server?.host || this.opts.defaultHost;
    for (const result of this.ensureServerLists(instance.dir, host, this.opts.profileName, DevMode.enabled(config.devMode))) {
      if (!result.ok) onStatus(`Avertissement servers.dat (${result.dir}): ${result.error}`);
    }
  }

  private serverListDirs(gameDir: string): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();
    for (const dir of [gameDir, this.opts.mcLauncherDir]) {
      const key = path.resolve(dir).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dirs.push(dir);
    }
    return dirs;
  }
}

function go(mb: number): string {
  return `${(mb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

function changedToggles(before: AppConfig, after: AppConfig): Exclude<ToggleTrigger, 'sync'>[] {
  const triggers: Exclude<ToggleTrigger, 'sync'>[] = [];
  if (after.potatoMode !== before.potatoMode) triggers.push('potato');
  if (after.disableSodium !== before.disableSodium) triggers.push('sodium');
  return triggers;
}
