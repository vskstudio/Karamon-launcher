import { DevMode } from './shared/DevMode';
import { app, ipcMain, dialog } from 'electron/main';
import { clipboard, shell } from 'electron/common';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  Channels,
  type AppConfigUpdate,
  type AuthLoginResult,
  type MinecraftProfile,
  type OfflineSkinRequest,
  type OfflineSkinResult,
  type NameCheckResult,
  type ExportLogsResult,
  type JavaCandidate,
  type LaunchResult,
  type ModsListResult,
  type PingResult,
  type RepairResult,
  type ReportConsentAnswer,
  type SetupResult,
  type SystemInfo,
} from '../ipc/contract';
import { Paths } from './shared/Paths';
import { HttpClient } from './shared/HttpClient';
import { loadPackProfile, type PackProfile } from './shared/PackProfile';
import { Config } from './features/config/Config';
import { ServerPing } from './features/server/ServerPing';
import { ServersDat } from './features/minecraft/ServersDat';
import { OptionsWriter } from './features/minecraft/OptionsWriter';
import { FabricInstaller } from './features/minecraft/FabricInstaller';
import { LauncherProfile } from './features/minecraft/LauncherProfile';
import { ModpackSync } from './features/modpack/ModpackSync';
import {
  MinecraftLauncher,
  type ServerListSetupResult,
} from './features/minecraft/MinecraftLauncher';
import { AutoUpdater } from './features/updater/AutoUpdater';
import { JavaDetector } from './features/java/JavaDetector';
import { JavaProvisioner } from './features/java/JavaProvisioner';
import { PlayStats } from './features/stats/PlayStats';
import { Screenshots } from './features/screenshots/Screenshots';
import { DiscordRpc } from './features/discord/DiscordRpc';
import { CrashReports } from './features/crashes/CrashReports';
import { Backup } from './features/backup/Backup';
import { ShopCatalog } from './features/shop/ShopCatalog';
import { SkinLookup } from './features/auth/SkinLookup';
import { AuthSession } from './features/auth/AuthSession';
import { MicrosoftSessionExpired } from './features/auth/MicrosoftAuth';
import { TokenStore } from './features/auth/TokenStore';
import { AccountStore } from './features/auth/AccountStore';
import { mojangNameStatus } from './features/auth/OfflineAccount';
import { resetSkin, saveSkin, savedSkinDataUrl } from './features/auth/OfflineSkin';
import { OFFLINE_NAME_TAKEN, isValidOfflineName, offlineNameProblem } from '../shared/OfflineName';
import { GameLauncher } from './features/minecraft/GameLauncher';
import { PotatoMode } from './features/potato/PotatoMode';
import { SodiumOff } from './features/sodium/SodiumOff';
import { lowEndReasons, potatoMemoryCapMb, type GpuDevice } from './features/potato/PotatoSettings';
import { WindowManager } from './WindowManager';
import { repairSummary } from './features/integrity/RepairSummary';
import { FileLog } from './shared/FileLog';
import { SystemCertificates } from './shared/SystemCertificates';
import { ReportCollector } from './features/reports/ReportCollector';
import { ReportManager } from './features/reports/ReportManager';
import { ReportQueue } from './features/reports/ReportQueue';
import { ReportTransport } from './features/reports/ReportTransport';
import { failureSummary, failureTrigger, type AutomaticTrigger } from './features/reports/ReportTriggers';

const SERVER_PING_TIMEOUT_MS = 5000;
const CLOSE_DELAY_MS = 2000;

export class KaramonApp {
  private readonly pack: PackProfile;
  private readonly paths = Paths.default();
  private readonly config = new Config(this.paths.configFile).load();
  private readonly http = new HttpClient();
  private readonly serverPing = new ServerPing();
  private readonly fabric: FabricInstaller;
  private readonly profile = new LauncherProfile(Paths.minecraftLauncherDir());
  private readonly modpackSync: ModpackSync;
  private readonly auth = new AuthSession(
    new TokenStore(this.paths.authCache),
    new AccountStore(this.paths.accountsFile),
  );
  private readonly gameLauncher: GameLauncher;
  private readonly javaDetector = new JavaDetector();
  private readonly javaProvisioner = new JavaProvisioner(this.paths, this.http, this.javaDetector);
  private readonly minecraft: MinecraftLauncher;

  private readonly window: WindowManager;
  private readonly fileLog = new FileLog(this.paths.logsDir);
  private readonly updater = new AutoUpdater({
    onReady: (info) => this.window.send(Channels.eventUpdateReady, info),
    log: (level, msg) => this.fileLog.write(level, `[Mise à jour] ${msg}`),
  });
  private readonly stats = new PlayStats(this.paths.dataDir);
  private readonly screenshots = new Screenshots();
  private readonly crashes = new CrashReports();
  private readonly backup = new Backup(this.paths.dataDir);
  private readonly shop = new ShopCatalog(this.http);
  private readonly skins = new SkinLookup(this.http);
  private readonly discord: DiscordRpc;
  private readonly reports: ReportManager;
  private javaCache: JavaCandidate[] | null = null;
  private repairing: Promise<RepairResult> | null = null;

  constructor(distDir: string, assetsDir: string) {
    this.pack = loadPackProfile(distDir);
    this.fabric = new FabricInstaller({
      mcVersion: this.pack.minecraft,
      fabricVersion: this.pack.fabricVersion,
      http: this.http,
    });
    this.modpackSync = new ModpackSync({
      http: this.http,
      optionsWriterFactory: (dir) => new OptionsWriter(dir),
      disabledJarPrefixes: this.pack.clientDisabledJarPrefixes,
      fallbackClientOptions: this.pack.clientOptions,
      parkedJars: (dir) => [...PotatoMode.parkedJars(dir), ...SodiumOff.parkedJars(dir)],
    });
    this.gameLauncher = new GameLauncher({
      paths: this.paths,
      http: this.http,
      auth: this.auth,
      mcVersion: this.pack.minecraft,
      fabricVersion: this.pack.fabricVersion,
    });
    this.minecraft = new MinecraftLauncher({
      mcLauncherDir: Paths.minecraftLauncherDir(),
      defaultInstanceDir: this.paths.instanceDir(this.pack.profileName),
      downloadsBaseUrl: this.pack.cdnBaseUrl,
      defaultHost: this.pack.statusFallbackHost,
      profileName: this.pack.profileName,
      modpackSync: this.modpackSync,
      serversDatFactory: (dir) => new ServersDat(dir),
      gameLauncher: this.gameLauncher,
      javaProvisioner: this.javaProvisioner,
    });
    this.window = new WindowManager(distDir, assetsDir);
    const cfg = this.config.get();
    this.discord = new DiscordRpc({
      serverHost: cfg.server?.host || this.pack.statusFallbackHost,
      serverPort: cfg.server?.port || 25565,
      pinger: this.serverPing,
      log: (msg) => this.window.send(Channels.eventStatus, msg),
    });
    this.reports = this.createReportManager();
  }

  /** Diagnostics sent to the Karamon panel. Never throws into the sync or launch flow. */
  private createReportManager(): ReportManager {
    const collector = new ReportCollector({
      dataDir: this.paths.dataDir,
      launcherVersion: app.getVersion(),
      bundledPackVersion: this.pack.version,
      // No installed pack version is stored locally: the published one is what the sync installs.
      getPackVersion: () =>
        Promise.race([
          this.http.getJson<{ version?: string }>(new URL('pack.json', this.pack.cdnBaseUrl).toString()).then((pack) => pack.version),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000).unref()),
        ]),
      getJavaVersion: async () => {
        const javaPath = this.config.get().javaPath;
        const list = await this.getJavaList();
        return (list.find((java) => java.path === javaPath) ?? list.find((java) => java.version.startsWith('21')) ?? list[0])?.version;
      },
      getGpu: () => KaramonApp.gpuLabel(),
      getPlayerName: () => this.auth.state().active?.name,
    });
    return new ReportManager({
      collector,
      queue: new ReportQueue(this.paths.dataDir),
      transport: new ReportTransport(),
      context: () => ({ gameDir: this.currentInstanceDir(), ramMb: this.config.get().memoryMb }),
      autoSend: () => this.config.get().autoSendReports,
      setAutoSend: (value) => this.config.set({ autoSendReports: value }),
      requestConsent: (request) => this.window.send(Channels.eventReportConsent, request),
      log: (msg) => this.fileLog.info(`[Rapports] ${msg}`),
    });
  }

  /** Automatic report after a problem; a failure only lands in launcher.log. */
  private reportProblem(trigger: AutomaticTrigger, summary: string[], since: number): void {
    this.reports
      .detect(trigger, summary, since)
      .then((result) => {
        if (result.status === 'sent') {
          this.window.send(Channels.eventStatus, `Rapport envoyé à l'équipe Karamon (code ${result.code}).`);
        }
      })
      .catch((e) => this.fileLog.warn(`[Rapports] ${(e as Error).message}`));
  }

  /** The latest crash report's cause, when the game wrote one in the last minutes. */
  private crashSummary(gameDir: string): string[] {
    try {
      const recent = this.crashes
        .list(gameDir)
        .reports.filter((report) => report.name.startsWith('crash-') && Date.now() - report.mtime < 10 * 60 * 1000)
        .sort((a, b) => b.mtime - a.mtime)[0];
      return recent ? [recent.summary] : [];
    } catch {
      return [];
    }
  }

  private static async gpuLabel(): Promise<string | undefined> {
    const gpus = await KaramonApp.gpuDevices();
    if (gpus.length === 0) return undefined;
    const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(4, '0');
    return gpus.map((gpu) => `${hex(gpu.vendorId)}:${hex(gpu.deviceId)}`).join(', ');
  }

  start(): void {
    this.fileLog.info(`Karamon Launcher ${app.getVersion()} démarré (${process.platform} ${process.arch}, Electron ${process.versions.electron})`);
    this.trustSystemCertificates();
    process.on('uncaughtException', (e) => this.fileLog.error('Exception non gérée', e));
    process.on('unhandledRejection', (e) => this.fileLog.error('Promesse rejetée non gérée', e));
    app.on('render-process-gone', (_e, _wc, details) =>
      this.fileLog.error(`Fenêtre du launcher plantée (${details.reason}, code ${details.exitCode})`),
    );
    app.on('child-process-gone', (_e, details) => {
      if (details.reason !== 'clean-exit') {
        this.fileLog.warn(`Processus ${details.type} arrêté (${details.reason}, code ${details.exitCode})`);
      }
    });
    app.whenReady().then(() => {
      Screenshots.registerProtocol(() => Screenshots.dirFor(this.currentInstanceDir()));
      this.registerIpc();
      const win = this.window.create();
      // Pending reports: retry the approved ones, ask again for the others once the page listens.
      win.webContents.once('did-finish-load', () => {
        this.reports.start().catch((e) => this.fileLog.warn(`[Rapports] ${(e as Error).message}`));
      });
      this.updater.start();
      this.discord.start();
      app.on('activate', () => {
        if (!this.window.exists()) this.window.create();
      });
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
    app.on('before-quit', () => {
      this.stats.endSession();
      void this.discord.destroy();
    });
  }

  private trustSystemCertificates(): void {
    const report = SystemCertificates.trust();
    if (report.failure !== undefined) {
      this.fileLog.error('Certificats racines du système illisibles, seuls ceux de Node sont utilisés', report.failure);
      return;
    }
    const summary = SystemCertificates.describe(report);
    if (report.rejected > 0) this.fileLog.warn(summary);
    else this.fileLog.info(summary);
  }

  private currentInstanceDir(): string {
    return this.minecraft.instanceDir(this.config.get());
  }

  private statusEmitter() {
    return (msg: string): void => {
      this.fileLog.info(msg);
      this.window.send(Channels.eventStatus, msg);
    };
  }

  /** Background work stops while Minecraft runs, and resumes when it closes. */
  private setGameRunning(running: boolean): void {
    this.updater.setPaused(running);
    this.discord.setPingPaused(running);
  }

  private progressEmitter() {
    return (val: number): void =>
      this.window.send(Channels.eventProgress, Math.max(0, Math.min(1, val)));
  }

  private registerIpc(): void {
    ipcMain.on(Channels.windowMinimize, () => this.window.minimize());
    ipcMain.on(Channels.windowMaximize, () => this.window.toggleMaximize());
    ipcMain.on(Channels.windowClose, () => this.window.close());
    ipcMain.on(Channels.updateInstall, () => this.updater.installNow());
    ipcMain.handle(Channels.updateCheck, () => this.updater.check());

    ipcMain.handle(Channels.configGet, () => this.config.get());
    ipcMain.handle(Channels.configSet, (_e, updates: AppConfigUpdate) => {
      const before = this.config.get();
      this.config.set(updates);
      const after = this.config.get();
      if (after.potatoMode !== before.potatoMode) this.minecraft.applyPotatoMode(after, this.statusEmitter());
      if (after.disableSodium !== before.disableSodium) this.minecraft.applySodiumOff(after, this.statusEmitter());
      return after;
    });

    ipcMain.handle(Channels.minecraftSetup, () => this.setupMinecraft());
    ipcMain.handle(Channels.launchPlay, () => this.play());
    ipcMain.handle(Channels.launchSyncMods, () => this.syncMods());
    ipcMain.handle(Channels.serverPing, () => this.pingServer());
    ipcMain.handle(Channels.folderInstance, () => this.openInstance());
    ipcMain.handle(Channels.folderData, () => this.openDataDir());
    ipcMain.handle(Channels.logsExport, (_e, text: string) => this.exportLogs(text));

    ipcMain.handle(Channels.launchRepair, () => this.repair());
    ipcMain.handle(Channels.modsList, () => this.listMods());
    ipcMain.handle(Channels.systemInfo, () => this.getSystemInfo());
    ipcMain.handle(Channels.javaList, () => this.getJavaList());
    ipcMain.handle(Channels.statsGet, () => this.stats.read());
    ipcMain.handle(Channels.statsReset, () => this.stats.reset());
    ipcMain.handle(Channels.screenshotsList, () =>
      this.screenshots.list(this.currentInstanceDir()),
    );
    ipcMain.handle(Channels.screenshotsDelete, (_e, name: string) =>
      this.screenshots.delete(this.currentInstanceDir(), name),
    );
    ipcMain.handle(Channels.shellOpenExternal, (_e, url: string) => this.openExternal(url));
    ipcMain.handle(Channels.crashesList, () =>
      this.crashes.list(this.currentInstanceDir()),
    );
    ipcMain.handle(Channels.crashesRead, (_e, name: string) =>
      this.crashes.read(this.currentInstanceDir(), name),
    );
    ipcMain.handle(Channels.crashesDelete, (_e, name: string) =>
      this.crashes.delete(this.currentInstanceDir(), name),
    );
    ipcMain.handle(Channels.crashesCopy, (_e, name: string) =>
      clipboard.writeText(this.crashes.read(this.currentInstanceDir(), name)),
    );
    ipcMain.handle(Channels.crashesReveal, (_e, name: string) =>
      shell.showItemInFolder(this.crashes.reportPath(this.currentInstanceDir(), name)),
    );
    ipcMain.handle(Channels.reportsSendManual, () => this.reports.sendManual());
    ipcMain.handle(Channels.reportsConsent, (_e, answer: ReportConsentAnswer) =>
      this.reports.answerConsent(String(answer?.reportId ?? ''), answer?.send === true, answer?.always === true),
    );
    ipcMain.handle(Channels.backupCreate, () =>
      this.backup.create(this.currentInstanceDir()),
    );
    ipcMain.handle(Channels.backupList, () => this.backup.list());
    ipcMain.handle(Channels.backupDelete, (_e, name: string) => this.backup.delete(name));

    ipcMain.handle(Channels.shopOffers, () => this.shop.offers());
    ipcMain.handle(Channels.skinUrl, (_e, profile: MinecraftProfile) =>
      (profile.kind === 'offline' && savedSkinDataUrl(this.currentInstanceDir(), profile.name)) || this.skins.skinFor(profile),
    );
    ipcMain.handle(Channels.skinOfflineSet, (_e, req: OfflineSkinRequest) =>
      this.writeOfflineSkin(() =>
        saveSkin(this.currentInstanceDir(), String(req?.name), Buffer.from(String(req?.png ?? ''), 'base64'), req?.model === 'slim' ? 'slim' : 'classic'),
      ),
    );
    ipcMain.handle(Channels.skinOfflineReset, (_e, name: string) =>
      this.writeOfflineSkin(() => resetSkin(this.currentInstanceDir(), String(name))),
    );

    ipcMain.handle(Channels.authLogin, () => this.authLogin());
    ipcMain.handle(Channels.authLoginOffline, (_e, name: string) => this.authLoginOffline(String(name)));
    ipcMain.handle(Channels.authCheckName, (_e, name: string) => this.authCheckName(String(name)));
    ipcMain.handle(Channels.authSwitch, (_e, accountId: string) => this.auth.switchTo(String(accountId)));
    ipcMain.handle(Channels.authLogout, () => this.auth.logout());
    ipcMain.handle(Channels.authGetSession, () => this.auth.state());
  }

  private writeOfflineSkin(write: () => void): OfflineSkinResult {
    try {
      write();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async authLogin(): Promise<AuthLoginResult> {
    try {
      const profile = await this.auth.login();
      return { ok: true, profile };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** A player without a Minecraft licence. A name Mojang knows is refused: the server would refuse it too. */
  private async authLoginOffline(name: string): Promise<AuthLoginResult> {
    const problem = offlineNameProblem(name);
    if (problem) return { ok: false, error: problem };
    if ((await mojangNameStatus(name)) === 'taken') {
      return { ok: false, error: OFFLINE_NAME_TAKEN };
    }
    try {
      const profile = this.auth.loginOffline(name);
      this.fileLog.info(`Compte sans licence enregistré : ${profile.name} (${profile.id})`);
      return { ok: true, profile };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async authCheckName(name: string): Promise<NameCheckResult> {
    if (!isValidOfflineName(name)) return 'unknown';
    return await mojangNameStatus(name);
  }

  private async openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  }

  private listMods(): ModsListResult {
    const dir = path.join(this.minecraft.instanceDir(this.config.get()), 'mods');
    return { dir, mods: ModpackSync.listMods(this.minecraft.instanceDir(this.config.get())) };
  }

  private async getSystemInfo(): Promise<SystemInfo> {
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
    const cpuCount = os.cpus().length;
    return {
      totalMemMb,
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      cpuCount,
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      lowEndReasons: lowEndReasons({ totalMemMb, cpuCount, gpus: await KaramonApp.gpuDevices() }),
      potatoMemoryCapMb: potatoMemoryCapMb(totalMemMb),
    };
  }

  /** GPUs Chromium sees (vendor ids only); empty when it can't tell. */
  private static async gpuDevices(): Promise<GpuDevice[]> {
    try {
      const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { vendorId?: unknown; deviceId?: unknown }[] };
      return (info.gpuDevice ?? [])
        .filter((gpu) => typeof gpu.vendorId === 'number')
        .map((gpu) => ({ vendorId: gpu.vendorId as number, deviceId: gpu.deviceId as number | undefined }));
    } catch {
      return [];
    }
  }

  private async getJavaList(): Promise<JavaCandidate[]> {
    if (!this.javaCache) {
      this.javaCache = await this.javaDetector.detect();
    }
    return this.javaCache;
  }

  private repair(): Promise<RepairResult> {
    if (!this.repairing) {
      this.repairing = this.runRepair().finally(() => {
        this.repairing = null;
      });
    }
    return this.repairing;
  }

  private async runRepair(): Promise<RepairResult> {
    const cfg = this.config.get();
    const onStatus = this.statusEmitter();
    const onProgress = this.progressEmitter();
    try {
      onProgress(0);
      onStatus("Réparation de l'installation : vérification complète...");
      const report = await this.minecraft.repair(cfg, onStatus, onProgress);
      const damaged = report.damaged.length;
      const configs = report.configs.repaired.length;
      const summary = repairSummary(damaged, configs);
      onProgress(1);
      onStatus(summary);
      return { ok: true, summary, damaged, configs };
    } catch (e) {
      const msg = (e as Error).message;
      onStatus('Erreur de réparation: ' + msg);
      onProgress(0);
      return { ok: false, error: msg };
    }
  }

  private async setupMinecraft(): Promise<SetupResult> {
    const cfg = this.config.get();
    const gameDir = this.minecraft.instanceDir(cfg);
    const launcherDir = Paths.minecraftLauncherDir();
    const host = cfg.server?.host || this.pack.statusFallbackHost;
    const results: string[] = [];
    let ok = true;

    const serverResults = this.minecraft.ensureServerLists(
      gameDir, host, this.pack.profileName, DevMode.enabled(cfg.devMode));
    const serverErrors = serverResults.filter(
      (r): r is Extract<ServerListSetupResult, { ok: false }> => !r.ok,
    );
    if (serverErrors.length === 0) {
      results.push(`servers.dat OK (${serverResults.length} emplacement(s))`);
    } else {
      ok = false;
      results.push(
        'servers.dat ERREUR ' +
          serverErrors.map((r) => `${r.dir}: ${r.error}`).join('; '),
      );
    }

    try {
      await this.fabric.ensureVersion(launcherDir);
      results.push('Fabric OK');
    } catch (e) {
      ok = false;
      results.push('Fabric ERREUR ' + (e as Error).message);
    }

    try {
      this.profile.ensure({
        name: this.pack.profileName,
        versionId: this.fabric.versionId,
        gameDir,
        memoryMb: cfg.memoryMb,
        jvmArgs: cfg.jvmArgs,
      });
      results.push('Profil OK');
    } catch (e) {
      ok = false;
      results.push('Profil ERREUR ' + (e as Error).message);
    }

    return {
      ok,
      details: results.join(' | '),
      path: gameDir,
    };
  }

  private async play(): Promise<LaunchResult> {
    const startedAt = Date.now();
    const cfg = this.config.get();
    const onStatus = this.statusEmitter();
    const onProgress = this.progressEmitter();
    const wasRunning = this.minecraft.isRunning();
    const gameDir = this.minecraft.instanceDir(cfg);
    try {
      onProgress(0);
      await this.minecraft.launch(cfg, {
        onStatus,
        onProgress,
        onLog: (line) => this.window.send(Channels.eventStatus, line),
        onExit: (code, corruption, trigger) => {
          this.fileLog.info(`Minecraft fermé (code ${code})${corruption.length ? `, corruption: ${corruption.join(', ')}` : ''}`);
          // Other instances still play: the session goes on until the last one closes.
          if (!this.minecraft.isRunning()) {
            this.setGameRunning(false);
            this.stats.endSession();
            this.discord.setMenu();
            this.window.send(Channels.eventGameState, { running: false });
          }
          this.window.send(
            Channels.eventStatus,
            code === 0 ? 'Minecraft fermé.' : `Minecraft fermé (code ${code}).`,
          );
          if (corruption.length > 0) void this.repairAfterCrash(corruption);
          if (trigger) {
            this.reportProblem(trigger, [`Code de sortie ${code}`, ...corruption, ...this.crashSummary(gameDir)], startedAt);
          }
        },
      });
      if (!wasRunning) this.stats.startSession();
      this.discord.setPlaying();
      this.setGameRunning(true);
      this.window.send(Channels.eventGameState, { running: true });
      onStatus('Minecraft lancé !');
      if (cfg.closeLauncherOnGameStart) setTimeout(() => this.window.close(), CLOSE_DELAY_MS);
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message;
      onStatus('Erreur: ' + msg);
      onProgress(0);
      if (!this.minecraft.isRunning()) this.window.send(Channels.eventGameState, { running: false });
      this.reportProblem(failureTrigger(e), failureSummary(e), startedAt);
      return { ok: false, error: msg, loginRequired: e instanceof MicrosoftSessionExpired };
    }
  }

  /** The game died at startup on damaged files: repair, then let the player relaunch. */
  private async repairAfterCrash(reasons: string[]): Promise<void> {
    this.window.send(
      Channels.eventStatus,
      `Le jeu a planté au démarrage sur des fichiers abîmés (${reasons.join(', ')}). Réparation automatique...`,
    );
    const result = await this.repair();
    this.window.send(Channels.eventRepairOffer, { reasons, result });
  }

  private async syncMods(): Promise<LaunchResult> {
    const startedAt = Date.now();
    const cfg = this.config.get();
    const onStatus = this.statusEmitter();
    const onProgress = this.progressEmitter();
    try {
      onProgress(0);
      await this.minecraft.syncOnly(cfg, onStatus, onProgress);
      onProgress(1);
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message;
      onStatus('Erreur de synchronisation: ' + msg);
      onProgress(0);
      this.reportProblem('sync_failed', ['Synchronisation du pack', msg], startedAt);
      return { ok: false, error: msg };
    }
  }

  private async pingServer(): Promise<PingResult> {
    const cfg = this.config.get();
    const host = cfg.server.host || this.pack.publicServerHost;
    const port = cfg.server.port;
    const candidates = this.statusPingHosts(host);

    return await new Promise<PingResult>((resolve) => {
      let settled = false;
      let remaining = candidates.length;

      const finish = (result: PingResult): void => {
        if (settled) return;
        if (result.online || --remaining === 0) {
          settled = true;
          resolve(result.online ? result : { online: false });
        }
      };

      for (const candidate of candidates) {
        this.serverPing
          .ping(candidate, port, SERVER_PING_TIMEOUT_MS)
          .then(finish)
          .catch(() => finish({ online: false }));
      }
    });
  }

  private statusPingHosts(host: string): string[] {
    const normalized = host.trim().toLowerCase();
    const hosts = [normalized];
    if (normalized === this.pack.publicServerHost) hosts.unshift(this.pack.statusFallbackHost);
    return [...new Set(hosts)];
  }

  private openInstance(): void {
    const dir = this.minecraft.instanceDir(this.config.get());
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  }

  private openDataDir(): void {
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    shell.openPath(this.paths.dataDir);
  }

  private async exportLogs(text: string): Promise<ExportLogsResult> {
    const win = this.window.current();
    const opts = {
      title: 'Exporter les logs',
      defaultPath: path.join(app.getPath('desktop'), `karamon-logs-${Date.now()}.txt`),
      filters: [{ name: 'Fichiers texte', extensions: ['txt'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      fs.writeFileSync(result.filePath, text, 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
