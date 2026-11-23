import { app, ipcMain } from 'electron/main';
import { shell } from 'electron/common';
import path from 'path';
import { routes } from '../ipc/contract';
import { IpcRouter } from './ipc/IpcRouter';
import { WindowManager } from './WindowManager';
import { registerWindowRoutes } from './WindowRoutes';
import { Paths } from './shared/Paths';
import { HttpClient } from './shared/HttpClient';
import { FileLog } from './shared/FileLog';
import { GameKeepAlive } from './GameKeepAlive';
import { SystemCertificates } from './shared/SystemCertificates';
import { loadKaramonProfile, type KaramonProfile } from './shared/KaramonProfile';
import { Config } from './features/config/Config';
import { registerConfigRoutes } from './features/config/ConfigRoutes';
import { ServerPing } from './features/server/ServerPing';
import { ServerStatus } from './features/server/ServerStatus';
import { registerServerRoutes } from './features/server/ServerRoutes';
import { FabricInstaller } from './features/minecraft/FabricInstaller';
import { LauncherProfile } from './features/minecraft/LauncherProfile';
import { GameLauncher } from './features/minecraft/GameLauncher';
import { MinecraftLauncher } from './features/minecraft/MinecraftLauncher';
import { MinecraftSetup } from './features/minecraft/MinecraftSetup';
import { registerMinecraftRoutes } from './features/minecraft/MinecraftRoutes';
import { ModpackSync } from './features/modpack/ModpackSync';
import { PackManifest } from './features/modpack/PackManifest';
import { registerModpackRoutes } from './features/modpack/ModpackRoutes';
import { AutoUpdater } from './features/updater/AutoUpdater';
import { registerUpdaterRoutes } from './features/updater/UpdaterRoutes';
import { JavaDetector } from './features/java/JavaDetector';
import { managedJavaRuntimeRoot } from './features/java/JavaProvisioner';
import { javaInstallRoots } from './features/java/JavaRuntime';
import { JavaProvisioner } from './features/java/JavaProvisioner';
import { registerJavaRoutes } from './features/java/JavaRoutes';
import { PlayStats } from './features/stats/PlayStats';
import { registerStatsRoutes } from './features/stats/StatsRoutes';
import { Screenshots } from './features/screenshots/Screenshots';
import { registerScreenshotRoutes } from './features/screenshots/ScreenshotRoutes';
import { DiscordRpc } from './features/discord/DiscordRpc';
import { CrashReports } from './features/crashes/CrashReports';
import { registerCrashRoutes } from './features/crashes/CrashRoutes';
import { Backup } from './features/backup/Backup';
import { registerBackupRoutes } from './features/backup/BackupRoutes';
import { Shop } from './features/shop/Shop';
import { openCheckoutWindow } from './features/shop/CheckoutWindow';
import { registerShopRoutes } from './features/shop/ShopRoutes';
import { Wiki } from './features/wiki/Wiki';
import { registerWikiRoutes } from './features/wiki/WikiRoutes';
import { AuthSession } from './features/auth/AuthSession';
import { TokenStore } from './features/auth/TokenStore';
import { AccountStore } from './features/auth/AccountStore';
import { SkinLookup } from './features/auth/SkinLookup';
import { registerAuthRoutes } from './features/auth/AuthRoutes';
import type { ReportManager } from './features/reports/ReportManager';
import { createLauncherReports } from './features/reports/LauncherReports';
import { registerReportRoutes } from './features/reports/ReportRoutes';
import { PlayActions } from './features/play/PlayActions';
import { playEventsTo, registerPlayRoutes } from './features/play/PlayRoutes';
import { gpuLabel } from './features/system/Gpu';
import { registerSystemRoutes } from './features/system/SystemRoutes';

export class KaramonApp {
  private readonly paths = Paths.default();
  private readonly fileLog = new FileLog(this.paths.logsDir);
  private readonly config = new Config(this.paths.configFile, (message) => this.fileLog.warn(message)).load();
  private readonly http = new HttpClient({ appVersion: app.getVersion() });
  private readonly auth = new AuthSession(new TokenStore(this.paths.authCache), new AccountStore(this.paths.accountsFile), this.http);
  private readonly stats = new PlayStats(this.paths.dataDir);
  private readonly crashes = new CrashReports();
  private readonly javaDetector = new JavaDetector([...javaInstallRoots(), managedJavaRuntimeRoot(this.paths)]);
  private readonly window: WindowManager;
  private readonly keepAlive: GameKeepAlive;
  private readonly pack: KaramonProfile;
  private readonly packManifest: PackManifest;
  private readonly minecraft: MinecraftLauncher;
  private readonly updater: AutoUpdater;
  private readonly serverStatus: ServerStatus;
  private readonly discord: DiscordRpc;
  private readonly reports: ReportManager;
  private readonly playActions: PlayActions;

  constructor(distDir: string, assetsDir: string) {
    this.window = new WindowManager(distDir, assetsDir);
    this.keepAlive = new GameKeepAlive({
      window: this.window,
      quit: () => app.quit(),
      quitsWhenLastWindowCloses: process.platform !== 'darwin',
    });
    this.pack = loadKaramonProfile(distDir);
    this.packManifest = new PackManifest({
      http: this.http,
      manifestUrl: new URL('pack.json', this.pack.cdnBaseUrl).toString(),
      stateFile: path.join(this.paths.dataDir, 'pack-versions.json'),
      bundled: { minecraft: this.pack.minecraft, fabricVersion: this.pack.fabricVersion },
    });
    this.minecraft = new MinecraftLauncher({
      mcLauncherDir: Paths.minecraftLauncherDir(),
      defaultInstanceDir: this.paths.instanceDir(this.pack.profileName),
      downloadsBaseUrl: this.pack.cdnBaseUrl,
      defaultHost: this.pack.statusFallbackHost,
      profileName: this.pack.profileName,
      modpackSync: new ModpackSync({
        http: this.http,
        disabledJarPrefixes: this.pack.clientDisabledJarPrefixes,
        fallbackClientOptions: this.pack.clientOptions,
      }),
      gameLauncher: new GameLauncher({
        paths: this.paths,
        http: this.http,
        auth: this.auth,
        mcVersion: this.pack.minecraft,
        fabricVersion: this.pack.fabricVersion,
      }),
      javaProvisioner: new JavaProvisioner(this.paths, this.http, this.javaDetector),
    });
    this.updater = new AutoUpdater({
      onReady: (info) => this.window.emit(routes.onUpdateReady, info),
      log: (level, msg) => this.fileLog.write(level, `[Mise à jour] ${msg}`),
    });
    this.serverStatus = new ServerStatus({
      pinger: new ServerPing(this.pack.protocolVersion),
      server: () => this.config.get().server,
      publicServerHost: this.pack.publicServerHost,
      statusFallbackHost: this.pack.statusFallbackHost,
    });
    this.discord = new DiscordRpc({
      status: this.serverStatus,
      log: (msg) => this.fileLog.info(`[Discord] ${msg}`),
    });
    this.reports = createLauncherReports({
      dataDir: this.paths.dataDir,
      http: this.http,
      launcherVersion: app.getVersion(),
      bundledPackVersion: this.pack.version,
      packManifest: this.packManifest,
      config: this.config,
      javas: this.javaDetector,
      gpuLabel,
      playerName: () => this.auth.state().active?.name,
      instanceDir: () => this.instanceDir(),
      requestConsent: (request) => this.window.emit(routes.onReportConsent, request),
      announce: (message) => this.window.emit(routes.onStatus, message),
      log: (msg) => this.fileLog.info(`[Rapports] ${msg}`),
    });
    this.playActions = new PlayActions({
      config: this.config,
      minecraft: this.minecraft,
      packManifest: this.packManifest,
      stats: this.stats,
      discord: this.discord,
      updater: this.updater,
      reports: this.reports,
      events: playEventsTo(this.window),
      keepAlive: this.keepAlive,
      status: (msg) => this.status(msg),
      progress: (value) => this.window.emit(routes.onProgress, Math.max(0, Math.min(1, value))),
      log: (msg) => this.fileLog.info(msg),
    });
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
      Screenshots.registerProtocol(() => Screenshots.dirFor(this.instanceDir()));
      this.registerRoutes();
      const win = this.window.create();
      win.webContents.once('did-finish-load', () => {
        this.reports.start().catch((e) => this.fileLog.warn(`[Rapports] ${(e as Error).message}`));
      });
      this.updater.start();
      this.discord.start();
      app.on('activate', () => this.keepAlive.windowRequested());
    });
    app.on('window-all-closed', () => this.keepAlive.allWindowsClosed());
    app.on('before-quit', () => {
      this.stats.endSession();
      void this.discord.destroy();
    });
  }

  private registerRoutes(): void {
    const router = new IpcRouter(ipcMain);
    const instanceDir = (): string => this.instanceDir();
    registerWindowRoutes(router, this.window);
    registerUpdaterRoutes(router, this.updater);
    registerConfigRoutes(router, {
      config: this.config,
      onChange: (before, after) => this.minecraft.applyModToggles(before, after, (msg) => this.status(msg)),
    });
    registerMinecraftRoutes(
      router,
      new MinecraftSetup({
        config: this.config,
        minecraft: this.minecraft,
        fabric: new FabricInstaller({ mcVersion: this.pack.minecraft, fabricVersion: this.pack.fabricVersion, http: this.http }),
        launcherProfile: new LauncherProfile(Paths.minecraftLauncherDir()),
        launcherDir: Paths.minecraftLauncherDir(),
        pack: this.pack,
      }),
    );
    registerPlayRoutes(router, this.playActions);
    registerServerRoutes(router, this.serverStatus);
    registerSystemRoutes(router, {
      appVersion: app.getVersion(),
      dataDir: this.paths.dataDir,
      instanceDir,
      window: () => this.window.current(),
    });
    registerModpackRoutes(router, {
      packManifest: this.packManifest,
      instanceDir,
      listMods: () => this.minecraft.listMods(this.config.get()),
    });
    registerJavaRoutes(router, this.javaDetector);
    registerStatsRoutes(router, this.stats);
    registerScreenshotRoutes(router, instanceDir);
    registerCrashRoutes(router, this.crashes, instanceDir);
    registerReportRoutes(router, this.reports);
    registerBackupRoutes(router, new Backup(this.paths.dataDir, () => this.minecraft.isRunning()), (operation) => {
      const session = this.minecraft.session(this.config.get());
      return session.exclusive(() => operation(session.instance.dir));
    });
    registerShopRoutes(
      router,
      new Shop({
        http: this.http,
        activeProfile: () => this.auth.state().active,
        openCheckout: (checkoutUrl) => openCheckoutWindow(this.window.current(), checkoutUrl),
        openExternal: (url) => shell.openExternal(url),
      }),
    );
    registerWikiRoutes(router, new Wiki(this.http, path.join(this.paths.cacheDir, 'wiki')));
    registerAuthRoutes(router, {
      auth: this.auth,
      skins: new SkinLookup(this.http),
      instanceDir,
      log: (msg) => this.fileLog.info(msg),
    });
    const unhandled = router.unhandled(routes);
    if (unhandled.length > 0) this.fileLog.error(`Routes IPC sans gestionnaire : ${unhandled.join(', ')}`);
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

  private instanceDir(): string {
    return this.minecraft.instanceDir(this.config.get());
  }

  private status(message: string): void {
    this.fileLog.info(message);
    this.window.emit(routes.onStatus, message);
  }
}
