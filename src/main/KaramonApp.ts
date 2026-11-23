import { app, ipcMain } from 'electron/main';
import { shell } from 'electron/common';
import { routes } from '../ipc/contract.ts';
import { IpcRouter } from './ipc/IpcRouter.ts';
import { WindowManager } from './WindowManager.ts';
import { registerWindowRoutes } from './WindowRoutes.ts';
import { Paths } from './shared/Paths.ts';
import type { GameInstance } from './shared/GameInstance.ts';
import { HttpClient } from './shared/HttpClient.ts';
import { FileLog } from './shared/FileLog.ts';
import { GameKeepAlive } from './GameKeepAlive.ts';
import type { SingleInstance } from './SingleInstance.ts';
import { SystemCertificates } from './shared/SystemCertificates.ts';
import { loadKaramonProfile, type KaramonProfile } from './shared/KaramonProfile.ts';
import { Config } from './features/config/Config.ts';
import { registerConfigRoutes } from './features/config/ConfigRoutes.ts';
import { ServerPing } from './features/server/ServerPing.ts';
import { ServerStatus } from './features/server/ServerStatus.ts';
import { registerServerRoutes } from './features/server/ServerRoutes.ts';
import { FabricInstaller } from './features/minecraft/FabricInstaller.ts';
import { LauncherProfile } from './features/minecraft/LauncherProfile.ts';
import { GameLauncher } from './features/minecraft/GameLauncher.ts';
import { MinecraftLauncher } from './features/minecraft/MinecraftLauncher.ts';
import { MinecraftSetup } from './features/minecraft/MinecraftSetup.ts';
import { registerMinecraftRoutes } from './features/minecraft/MinecraftRoutes.ts';
import { ModpackSync } from './features/modpack/ModpackSync.ts';
import { PackManifest } from './features/modpack/PackManifest.ts';
import { registerModpackRoutes } from './features/modpack/ModpackRoutes.ts';
import { AutoUpdater } from './features/updater/AutoUpdater.ts';
import { registerUpdaterRoutes } from './features/updater/UpdaterRoutes.ts';
import { JavaDetector } from './features/java/JavaDetector.ts';
import { managedJavaRuntimeRoot } from './features/java/JavaProvisioner.ts';
import { javaInstallRoots } from './features/java/JavaRuntime.ts';
import { JavaProvisioner } from './features/java/JavaProvisioner.ts';
import { registerJavaRoutes } from './features/java/JavaRoutes.ts';
import { PlayStats } from './features/stats/PlayStats.ts';
import { registerStatsRoutes } from './features/stats/StatsRoutes.ts';
import { Screenshots } from './features/screenshots/Screenshots.ts';
import { registerScreenshotRoutes } from './features/screenshots/ScreenshotRoutes.ts';
import { DiscordRpc } from './features/discord/DiscordRpc.ts';
import { CrashReports } from './features/crashes/CrashReports.ts';
import { registerCrashRoutes } from './features/crashes/CrashRoutes.ts';
import { Backup } from './features/backup/Backup.ts';
import { registerBackupRoutes } from './features/backup/BackupRoutes.ts';
import { Shop } from './features/shop/Shop.ts';
import { openCheckoutWindow } from './features/shop/CheckoutWindow.ts';
import { registerShopRoutes } from './features/shop/ShopRoutes.ts';
import { Wiki } from './features/wiki/Wiki.ts';
import { registerWikiRoutes } from './features/wiki/WikiRoutes.ts';
import { AuthSession } from './features/auth/AuthSession.ts';
import { TokenStore } from './features/auth/TokenStore.ts';
import { AccountStore } from './features/auth/AccountStore.ts';
import { SkinLookup } from './features/auth/SkinLookup.ts';
import { registerAuthRoutes } from './features/auth/AuthRoutes.ts';
import type { ReportManager } from './features/reports/ReportManager.ts';
import { createLauncherReports } from './features/reports/LauncherReports.ts';
import { registerReportRoutes } from './features/reports/ReportRoutes.ts';
import { PlayActions } from './features/play/PlayActions.ts';
import { playEventsTo, registerPlayRoutes } from './features/play/PlayRoutes.ts';
import { gpuLabel } from './features/system/Gpu.ts';
import { registerSystemRoutes } from './features/system/SystemRoutes.ts';

export class KaramonApp {
  private readonly paths = Paths.default();
  private readonly fileLog = new FileLog(this.paths.launcherLog);
  private readonly config = new Config(this.paths.configFile, (message) => this.fileLog.warn(message)).load();
  private readonly http = new HttpClient({ appVersion: app.getVersion() });
  private readonly auth = new AuthSession(new TokenStore(this.paths.authCache), new AccountStore(this.paths.accountsFile), this.http);
  private readonly stats = new PlayStats(this.paths.statsFile);
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
      stateFile: this.paths.packVersionsFile,
      bundled: { minecraft: this.pack.minecraft, fabricVersion: this.pack.fabricVersion },
    });
    this.minecraft = new MinecraftLauncher({
      mcLauncherDir: Paths.minecraftLauncherDir(),
      defaultInstanceDir: this.paths.instanceDir(this.pack.profileName),
      downloadsBaseUrl: this.pack.cdnBaseUrl,
      defaultHost: this.pack.statusFallbackHost,
      profileName: this.pack.profileName,
      minecraftVersion: this.pack.minecraft,
      modpackSync: new ModpackSync({
        http: this.http,
        disabledJarPrefixes: this.pack.clientDisabledJarPrefixes,
        disabledJarReason: this.pack.clientDisabledJarReason,
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
      log: (msg) => this.fileLog.info(msg),
    });
    this.reports = createLauncherReports({
      launcherLog: this.paths.launcherLog,
      reportsDir: this.paths.reportsDir,
      http: this.http,
      launcherVersion: app.getVersion(),
      bundledPackVersion: this.pack.version,
      packManifest: this.packManifest,
      config: this.config,
      javas: this.javaDetector,
      gpuLabel,
      playerName: () => this.auth.state().active?.name,
      instance: () => this.instance(),
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

  start(instanceLock: SingleInstance): void {
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
      Screenshots.registerProtocol(() => this.instance().screenshotsDir);
      this.registerRoutes();
      const win = this.window.create();
      win.webContents.once('did-finish-load', () => {
        this.reports.start().catch((e) => this.fileLog.warn(`[Rapports] ${(e as Error).message}`));
      });
      this.updater.start();
      this.discord.start();
      app.on('activate', () => this.keepAlive.windowRequested());
      instanceLock.whenRelaunched(() => this.keepAlive.windowRequested());
    });
    app.on('window-all-closed', () => this.keepAlive.allWindowsClosed());
    app.on('before-quit', () => {
      this.stats.endSession();
      void this.discord.destroy();
    });
  }

  private registerRoutes(): void {
    const router = new IpcRouter(ipcMain);
    const instance = (): GameInstance => this.instance();
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
      instance,
      window: () => this.window.current(),
    });
    registerModpackRoutes(router, {
      packManifest: this.packManifest,
      instance,
      listMods: () => this.minecraft.listMods(this.config.get()),
    });
    registerJavaRoutes(router, this.javaDetector);
    registerStatsRoutes(router, this.stats);
    registerScreenshotRoutes(router, instance);
    registerCrashRoutes(router, this.crashes, instance);
    registerReportRoutes(router, this.reports);
    registerBackupRoutes(router, new Backup(this.paths.backupsDir, () => this.minecraft.isRunning()), (operation) => {
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
    registerWikiRoutes(router, new Wiki(this.http, this.paths.wikiCacheDir));
    registerAuthRoutes(router, {
      auth: this.auth,
      skins: new SkinLookup(this.http),
      instance,
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

  private instance(): GameInstance {
    return this.minecraft.session(this.config.get()).instance;
  }

  private status(message: string): void {
    this.fileLog.info(message);
    this.window.emit(routes.onStatus, message);
  }
}
