export interface ServerInfo {
  host: string;
  port: number;
}

export interface AppConfig {
  mcGameDir: string;
  memoryMb: number;
  javaPath: string;
  jvmArgs: string;
  closeLauncherOnGameStart: boolean;
  devMode: boolean;
  /** Mode PC modeste: no shaders, low video settings, heavy visual mods off, capped memory. */
  potatoMode: boolean;
  /** The suggestion to turn it on was shown and answered. */
  potatoHintDismissed: boolean;
  disableSodium: boolean;
  server: ServerInfo;
}

export type AppConfigUpdate = Partial<Omit<AppConfig, 'server'>> & {
  server?: Partial<ServerInfo>;
};

export interface SetupResult {
  ok: boolean;
  details: string;
  path: string;
}

export type LaunchResult = { ok: true } | { ok: false; error: string };

export type RepairResult =
  | { ok: true; summary: string; damaged: number; configs: number }
  | { ok: false; error: string };

/** Sent after a startup crash that points at damaged files, once the repair ran. */
export interface RepairOffer {
  reasons: string[];
  result: RepairResult;
}

export interface SamplePlayer {
  name: string;
  id?: string;
}

export type PingResult =
  | {
      online: true;
      players: number;
      maxPlayers: number;
      motd: string;
      version: string;
      sample?: SamplePlayer[];
    }
  | { online: false };

export type ExportLogsResult = { ok: boolean; error?: string };

export interface GameState {
  running: boolean;
}

export type UpdateInstall = 'restart' | 'download';

export interface UpdateInfo {
  version: string;
  install: UpdateInstall;
}

export type UpdateCheckResult =
  | { status: 'no-update'; currentVersion: string }
  | { status: 'downloading'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'available'; version: string }
  | { status: 'error'; error: string }
  | { status: 'unsupported' };

export interface ModEntry {
  name: string;
  size: number;
  /** Kept as `<name>.disabled` (mode PC modeste). */
  disabled?: boolean;
}

export interface ModsListResult {
  dir: string;
  mods: ModEntry[];
}

export interface SystemInfo {
  totalMemMb: number;
  freeMemMb: number;
  cpuCount: number;
  platform: string;
  arch: string;
  appVersion: string;
  /** Why this PC looks modest ("8 Go de RAM", "carte graphique intégrée"…); empty when it does not. */
  lowEndReasons: string[];
  /** Memory the mode PC modeste starts the game with at most, or null when it keeps the setting. */
  potatoMemoryCapMb: number | null;
}

export interface JavaCandidate {
  path: string;
  version: string;
  vendor: string;
}

export interface PlayStats {
  totalPlayMs: number;
  sessions: number;
  lastPlayedAt: number | null;
  firstPlayedAt: number | null;
}

export interface ScreenshotEntry {
  name: string;
  url: string;
  size: number;
  mtime: number;
}

export interface ScreenshotsListResult {
  dir: string;
  screenshots: ScreenshotEntry[];
}

export interface CrashReport {
  name: string;
  mtime: number;
  size: number;
  summary: string;
  excerpt: string;
}

export interface CrashReportsListResult {
  dir: string;
  reports: CrashReport[];
}

export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface BackupListResult {
  dir: string;
  backups: BackupEntry[];
}

export interface ShopOffer {
  id: string;
  name: string;
  description: string;
  image: string;
  lumis: number;
  bonus: number;
  priceCents: number;
  currency: string;
}

/** A skin for an offline account: the PNG in base64 (64×64 or 64×32, 32 KB at most) and its arm width. */
export interface OfflineSkinRequest {
  name: string;
  png: string;
  model: 'classic' | 'slim';
}

export interface OfflineSkinResult {
  ok: boolean;
  error?: string;
}

/** `offline`: a player without a Minecraft licence, protected by a Karamon password asked in game. */
export type AccountKind = 'microsoft' | 'offline';

export interface MinecraftProfile {
  id: string;
  name: string;
  kind: AccountKind;
}

export type AuthLoginResult =
  | { ok: true; profile: MinecraftProfile }
  | { ok: false; error: string };

export interface AuthSessionResult {
  /** The account that plays, or null when signed out. */
  active: MinecraftProfile | null;
  /** Every account the launcher remembers, the active one included. */
  accounts: MinecraftProfile[];
}

/** `taken`: a Mojang account owns the name; `unknown`: Mojang could not be asked. */
export type NameCheckResult = 'free' | 'taken' | 'unknown';

export const Channels = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  configGet: 'config:get',
  configSet: 'config:set',

  minecraftSetup: 'minecraft:setup',
  launchPlay: 'launch:play',
  launchSyncMods: 'launch:sync-mods',
  launchRepair: 'launch:repair',

  serverPing: 'server:ping',

  folderInstance: 'folder:instance',
  folderData: 'folder:data',

  logsExport: 'logs:export',

  updateInstall: 'update:install',
  updateCheck: 'update:check',

  modsList: 'mods:list',
  systemInfo: 'system:info',
  javaList: 'java:list',
  statsGet: 'stats:get',
  statsReset: 'stats:reset',
  screenshotsList: 'screenshots:list',
  screenshotsDelete: 'screenshots:delete',
  shellOpenExternal: 'shell:open-external',
  crashesList: 'crashes:list',
  crashesRead: 'crashes:read',
  crashesDelete: 'crashes:delete',
  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupDelete: 'backup:delete',

  shopOffers: 'shop:offers',
  skinUrl: 'skin:url',
  skinOfflineSet: 'skin:offline-set',
  skinOfflineReset: 'skin:offline-reset',

  authLogin: 'auth:login',
  authLoginOffline: 'auth:login-offline',
  authCheckName: 'auth:check-name',
  authSwitch: 'auth:switch',
  authLogout: 'auth:logout',
  authGetSession: 'auth:get-session',

  eventStatus: 'status:update',
  eventProgress: 'progress:update',
  eventGameState: 'game:state',
  eventUpdateReady: 'update:ready',
  eventRepairOffer: 'repair:offer',
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];

export interface IpcInvokeContract {
  [Channels.configGet]: { req: void; res: AppConfig };
  [Channels.configSet]: { req: AppConfigUpdate; res: AppConfig };
  [Channels.minecraftSetup]: { req: void; res: SetupResult };
  [Channels.launchPlay]: { req: void; res: LaunchResult };
  [Channels.launchSyncMods]: { req: void; res: LaunchResult };
  [Channels.launchRepair]: { req: void; res: RepairResult };
  [Channels.serverPing]: { req: void; res: PingResult };
  [Channels.folderInstance]: { req: void; res: void };
  [Channels.folderData]: { req: void; res: void };
  [Channels.logsExport]: { req: string; res: ExportLogsResult };
  [Channels.updateCheck]: { req: void; res: UpdateCheckResult };
  [Channels.modsList]: { req: void; res: ModsListResult };
  [Channels.systemInfo]: { req: void; res: SystemInfo };
  [Channels.javaList]: { req: void; res: JavaCandidate[] };
  [Channels.statsGet]: { req: void; res: PlayStats };
  [Channels.statsReset]: { req: void; res: PlayStats };
  [Channels.screenshotsList]: { req: void; res: ScreenshotsListResult };
  [Channels.screenshotsDelete]: { req: string; res: ScreenshotsListResult };
  [Channels.shellOpenExternal]: { req: string; res: void };
  [Channels.crashesList]: { req: void; res: CrashReportsListResult };
  [Channels.crashesRead]: { req: string; res: string };
  [Channels.crashesDelete]: { req: string; res: CrashReportsListResult };
  [Channels.backupCreate]: { req: void; res: BackupEntry };
  [Channels.backupList]: { req: void; res: BackupListResult };
  [Channels.backupDelete]: { req: string; res: BackupListResult };
  [Channels.shopOffers]: { req: void; res: ShopOffer[] };
  [Channels.skinUrl]: { req: MinecraftProfile; res: string | null };
  [Channels.skinOfflineSet]: { req: OfflineSkinRequest; res: OfflineSkinResult };
  [Channels.skinOfflineReset]: { req: string; res: OfflineSkinResult };
  [Channels.authLogin]: { req: void; res: AuthLoginResult };
  [Channels.authLoginOffline]: { req: string; res: AuthLoginResult };
  [Channels.authCheckName]: { req: string; res: NameCheckResult };
  [Channels.authSwitch]: { req: string; res: AuthSessionResult };
  [Channels.authLogout]: { req: void; res: AuthSessionResult };
  [Channels.authGetSession]: { req: void; res: AuthSessionResult };
}

export interface IpcSendContract {
  [Channels.windowMinimize]: void;
  [Channels.windowMaximize]: void;
  [Channels.windowClose]: void;
  [Channels.updateInstall]: void;
}

export interface IpcEventContract {
  [Channels.eventStatus]: string;
  [Channels.eventProgress]: number;
  [Channels.eventGameState]: GameState;
  [Channels.eventUpdateReady]: UpdateInfo;
  [Channels.eventRepairOffer]: RepairOffer;
}

export interface LauncherApi {
  minimize(): void;
  maximize(): void;
  close(): void;

  getConfig(): Promise<AppConfig>;
  saveConfig(updates: AppConfigUpdate): Promise<AppConfig>;

  setupMinecraft(): Promise<SetupResult>;

  play(): Promise<LaunchResult>;
  syncMods(): Promise<LaunchResult>;
  repair(): Promise<RepairResult>;

  pingServer(): Promise<PingResult>;

  openInstance(): Promise<void>;
  openData(): Promise<void>;

  exportLogs(text: string): Promise<ExportLogsResult>;

  installUpdate(): void;
  checkForUpdate(): Promise<UpdateCheckResult>;

  listMods(): Promise<ModsListResult>;
  systemInfo(): Promise<SystemInfo>;
  listJava(): Promise<JavaCandidate[]>;
  getStats(): Promise<PlayStats>;
  resetStats(): Promise<PlayStats>;
  listScreenshots(): Promise<ScreenshotsListResult>;
  deleteScreenshot(name: string): Promise<ScreenshotsListResult>;
  openExternal(url: string): Promise<void>;
  listCrashes(): Promise<CrashReportsListResult>;
  readCrash(name: string): Promise<string>;
  deleteCrash(name: string): Promise<CrashReportsListResult>;
  createBackup(): Promise<BackupEntry>;
  listBackups(): Promise<BackupListResult>;
  deleteBackup(name: string): Promise<BackupListResult>;

  listShopOffers(): Promise<ShopOffer[]>;
  skinUrl(profile: MinecraftProfile): Promise<string | null>;
  /** The skin of an offline account, sent by the game with its next Karamon login. */
  skinOfflineSet(request: OfflineSkinRequest): Promise<OfflineSkinResult>;
  /** Back to the Ely.by / TLauncher skin (or Steve) at the next login. */
  skinOfflineReset(name: string): Promise<OfflineSkinResult>;

  authLogin(): Promise<AuthLoginResult>;
  authLoginOffline(name: string): Promise<AuthLoginResult>;
  authCheckName(name: string): Promise<NameCheckResult>;
  authSwitch(accountId: string): Promise<AuthSessionResult>;
  authLogout(): Promise<AuthSessionResult>;
  authGetSession(): Promise<AuthSessionResult>;

  onStatus(cb: (msg: string) => void): void;
  onProgress(cb: (val: number) => void): void;
  onGameState(cb: (state: GameState) => void): void;
  onUpdateReady(cb: (info: UpdateInfo) => void): void;
  onRepairOffer(cb: (offer: RepairOffer) => void): void;
}

declare global {
  interface Window {
    launcher: LauncherApi;
  }
}
