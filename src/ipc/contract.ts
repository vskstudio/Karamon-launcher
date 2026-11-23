import { event, invoke, send, type ApiOf } from './Route.ts';
import {
  fileName,
  flag,
  httpUrl,
  identifier,
  logText,
  object,
  oneOf,
  playerName,
  record,
  skinPng,
  wikiSlug,
} from './RequestDecoders.ts';
import type { AppConfig, AppConfigUpdate } from '../main/features/config/Config.ts';
import type { SetupResult } from '../main/features/minecraft/MinecraftSetup.ts';
import type { GameState, RepairDone, RepairOffer } from '../main/features/play/PlayActions.ts';
import type { PingResult } from '../main/features/server/ServerPing.ts';
import type { UpdateCheckResult, UpdateInfo } from '../main/features/updater/AutoUpdater.ts';
import type { ModsListResult } from '../main/shared/GameInstance.ts';
import type { PackInfo } from '../main/features/modpack/PackManifest.ts';
import type { SystemInfo } from '../main/features/system/SystemInfo.ts';
import type { JavaInstall as JavaCandidate } from '../main/features/java/JavaRuntime.ts';
import type { PlayStatsData } from '../main/features/stats/PlayStats.ts';
import type { ScreenshotsListResult } from '../main/features/screenshots/Screenshots.ts';
import type { CrashReportsListResult } from '../main/features/crashes/CrashReports.ts';
import type { ReportConsentAnswer, ReportConsentRequest, ReportSendResult } from '../main/features/reports/ReportTypes.ts';
import type { BackupEntry, BackupListResult } from '../main/features/backup/Backup.ts';
import type { ShopCatalog, ShopCheckoutResult } from '../main/features/shop/Shop.ts';
import type { WikiGroup, WikiPage } from '../main/features/wiki/WikiTypes.ts';
import type { MinecraftProfile } from '../main/features/auth/MinecraftProfile.ts';
import type { OfflineSkinRequest } from '../main/features/auth/OfflineSkin.ts';
import type { AuthSessionResult } from '../main/features/auth/AuthSession.ts';
import type { NameStatus } from '../main/features/auth/OfflineAccount.ts';

export type { AppConfig, AppConfigUpdate, ServerInfo } from '../main/features/config/Config.ts';
export type { SetupResult } from '../main/features/minecraft/MinecraftSetup.ts';
export type { GameState, RepairDone, RepairOffer, RepairResult } from '../main/features/play/PlayActions.ts';
export type { PingResult, SamplePlayer } from '../main/features/server/ServerPing.ts';
export type { UpdateCheckResult, UpdateInfo, UpdateInstall } from '../main/features/updater/AutoUpdater.ts';
export type { InstalledMod as ModEntry, ModsListResult } from '../main/shared/GameInstance.ts';
export type { PackInfo } from '../main/features/modpack/PackManifest.ts';
export type { SystemInfo } from '../main/features/system/SystemInfo.ts';
export type { JavaInstall as JavaCandidate } from '../main/features/java/JavaRuntime.ts';
export type { PlayStatsData as PlayStats } from '../main/features/stats/PlayStats.ts';
export type { ScreenshotEntry, ScreenshotsListResult } from '../main/features/screenshots/Screenshots.ts';
export type { CrashReport, CrashReportsListResult } from '../main/features/crashes/CrashReports.ts';
export type {
  ReportConsentAnswer,
  ReportConsentRequest,
  ReportSendResult,
  ReportTrigger,
} from '../main/features/reports/ReportTypes.ts';
export type { BackupEntry, BackupListResult } from '../main/features/backup/Backup.ts';
export type { ShopCatalog, ShopCheckoutResult, ShopOffer, ShopOfferKind } from '../main/features/shop/Shop.ts';
export type { WikiBlock, WikiCalloutTone, WikiGroup, WikiInline, WikiPage, WikiPageRef } from '../main/features/wiki/WikiTypes.ts';
export type { AccountKind, MinecraftProfile } from '../main/features/auth/MinecraftProfile.ts';
export type { OfflineSkinRequest, SkinModel } from '../main/features/auth/OfflineSkin.ts';
export type { AuthSessionResult } from '../main/features/auth/AuthSession.ts';
export type { NameStatus } from '../main/features/auth/OfflineAccount.ts';

const reportConsentAnswer = object<ReportConsentAnswer>('une réponse au rapport', {
  reportId: identifier,
  send: flag,
  always: flag,
});

const minecraftProfile = object<MinecraftProfile>('un compte Minecraft', {
  id: identifier,
  name: playerName,
  kind: oneOf('un type de compte', ['microsoft', 'offline']),
});

const offlineSkinRequest = object<OfflineSkinRequest>('un skin', {
  name: playerName,
  png: skinPng,
  model: oneOf('une largeur de bras', ['classic', 'slim']),
});

export const routes = {
  minimize: send('window:minimize'),
  maximize: send('window:maximize'),
  close: send('window:close'),

  getConfig: invoke('config:get').returns<AppConfig>(),
  saveConfig: invoke('config:set', record<AppConfigUpdate>('des réglages')).returns<AppConfig>(),

  setupMinecraft: invoke('minecraft:setup').returns<SetupResult>(),

  play: invoke('launch:play').returns<void>(),
  syncMods: invoke('launch:sync-mods').returns<void>(),
  repair: invoke('launch:repair').returns<RepairDone>(),

  pingServer: invoke('server:ping').returns<PingResult>(),

  openInstance: invoke('folder:instance').returns<void>(),
  openData: invoke('folder:data').returns<void>(),

  exportLogs: invoke('logs:export', logText).returns<boolean>(),

  installUpdate: send('update:install'),
  checkForUpdate: invoke('update:check').returns<UpdateCheckResult>(),

  listMods: invoke('mods:list').returns<ModsListResult>(),
  systemInfo: invoke('system:info').returns<SystemInfo>(),
  listJava: invoke('java:list').returns<JavaCandidate[]>(),
  getStats: invoke('stats:get').returns<PlayStatsData>(),
  resetStats: invoke('stats:reset').returns<PlayStatsData>(),
  listScreenshots: invoke('screenshots:list').returns<ScreenshotsListResult>(),
  deleteScreenshot: invoke('screenshots:delete', fileName).returns<ScreenshotsListResult>(),
  openExternal: invoke('shell:open-external', httpUrl).returns<void>(),
  listCrashes: invoke('crashes:list').returns<CrashReportsListResult>(),
  readCrash: invoke('crashes:read', fileName).returns<string>(),
  deleteCrash: invoke('crashes:delete', fileName).returns<CrashReportsListResult>(),
  copyCrash: invoke('crashes:copy', fileName).returns<void>(),
  revealCrash: invoke('crashes:reveal', fileName).returns<void>(),
  sendManualReport: invoke('reports:send-manual').returns<ReportSendResult>(),
  answerReportConsent: invoke('reports:consent', reportConsentAnswer).returns<ReportSendResult>(),
  createBackup: invoke('backup:create').returns<BackupEntry>(),
  listBackups: invoke('backup:list').returns<BackupListResult>(),
  deleteBackup: invoke('backup:delete', fileName).returns<BackupListResult>(),

  shopCatalog: invoke('shop:offers').returns<ShopCatalog>(),
  shopCheckout: invoke('shop:checkout', identifier).returns<ShopCheckoutResult>(),
  shopPortal: invoke('shop:portal').returns<void>(),
  wikiIndex: invoke('wiki:index').returns<WikiGroup[]>(),
  wikiPage: invoke('wiki:page', wikiSlug).returns<WikiPage | null>(),
  packInfo: invoke('pack:info').returns<PackInfo>(),
  skinUrl: invoke('skin:url', minecraftProfile).returns<string | null>(),
  skinOfflineSet: invoke('skin:offline-set', offlineSkinRequest).returns<void>(),
  skinOfflineReset: invoke('skin:offline-reset', playerName).returns<void>(),

  authLogin: invoke('auth:login').returns<MinecraftProfile>(),
  authLoginOffline: invoke('auth:login-offline', playerName).returns<MinecraftProfile>(),
  authCheckName: invoke('auth:check-name', playerName).returns<NameStatus>(),
  authSwitch: invoke('auth:switch', identifier).returns<AuthSessionResult>(),
  authLogout: invoke('auth:logout').returns<AuthSessionResult>(),
  authGetSession: invoke('auth:get-session').returns<AuthSessionResult>(),

  onStatus: event<string>('status:update'),
  onProgress: event<number>('progress:update'),
  onGameState: event<GameState>('game:state'),
  onUpdateReady: event<UpdateInfo>('update:ready'),
  onRepairOffer: event<RepairOffer>('repair:offer'),
  onReportConsent: event<ReportConsentRequest>('reports:consent-request'),
};

export type LauncherApi = ApiOf<typeof routes>;
