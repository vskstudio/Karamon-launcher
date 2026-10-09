import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type LauncherApi } from '../ipc/contract';

const api: LauncherApi = {
  minimize: () => ipcRenderer.send(Channels.windowMinimize),
  maximize: () => ipcRenderer.send(Channels.windowMaximize),
  close: () => ipcRenderer.send(Channels.windowClose),

  getConfig: () => ipcRenderer.invoke(Channels.configGet),
  saveConfig: (updates) => ipcRenderer.invoke(Channels.configSet, updates),

  setupMinecraft: () => ipcRenderer.invoke(Channels.minecraftSetup),

  play: () => ipcRenderer.invoke(Channels.launchPlay),
  syncMods: () => ipcRenderer.invoke(Channels.launchSyncMods),

  pingServer: () => ipcRenderer.invoke(Channels.serverPing),

  openInstance: () => ipcRenderer.invoke(Channels.folderInstance),
  openData: () => ipcRenderer.invoke(Channels.folderData),

  exportLogs: (text) => ipcRenderer.invoke(Channels.logsExport, text),

  installUpdate: () => ipcRenderer.send(Channels.updateInstall),
  checkForUpdate: () => ipcRenderer.invoke(Channels.updateCheck),

  repair: () => ipcRenderer.invoke(Channels.launchRepair),
  listMods: () => ipcRenderer.invoke(Channels.modsList),
  systemInfo: () => ipcRenderer.invoke(Channels.systemInfo),
  listJava: () => ipcRenderer.invoke(Channels.javaList),
  getStats: () => ipcRenderer.invoke(Channels.statsGet),
  resetStats: () => ipcRenderer.invoke(Channels.statsReset),
  listScreenshots: () => ipcRenderer.invoke(Channels.screenshotsList),
  deleteScreenshot: (name) => ipcRenderer.invoke(Channels.screenshotsDelete, name),
  openExternal: (url) => ipcRenderer.invoke(Channels.shellOpenExternal, url),
  listCrashes: () => ipcRenderer.invoke(Channels.crashesList),
  readCrash: (name) => ipcRenderer.invoke(Channels.crashesRead, name),
  deleteCrash: (name) => ipcRenderer.invoke(Channels.crashesDelete, name),
  createBackup: () => ipcRenderer.invoke(Channels.backupCreate),
  listBackups: () => ipcRenderer.invoke(Channels.backupList),
  deleteBackup: (name) => ipcRenderer.invoke(Channels.backupDelete, name),

  listShopOffers: () => ipcRenderer.invoke(Channels.shopOffers),
  skinUrl: (profile) => ipcRenderer.invoke(Channels.skinUrl, profile),

  authLogin: () => ipcRenderer.invoke(Channels.authLogin),
  authLoginOffline: (name) => ipcRenderer.invoke(Channels.authLoginOffline, name),
  authCheckName: (name) => ipcRenderer.invoke(Channels.authCheckName, name),
  authSwitch: (accountId) => ipcRenderer.invoke(Channels.authSwitch, accountId),
  authLogout: () => ipcRenderer.invoke(Channels.authLogout),
  authGetSession: () => ipcRenderer.invoke(Channels.authGetSession),

  onStatus: (cb) => {
    ipcRenderer.on(Channels.eventStatus, (_e, msg: string) => cb(msg));
  },
  onProgress: (cb) => {
    ipcRenderer.on(Channels.eventProgress, (_e, val: number) => cb(val));
  },
  onGameState: (cb) => {
    ipcRenderer.on(Channels.eventGameState, (_e, state) => cb(state));
  },
  onUpdateReady: (cb) => {
    ipcRenderer.on(Channels.eventUpdateReady, (_e, info) => cb(info));
  },
  onRepairOffer: (cb) => {
    ipcRenderer.on(Channels.eventRepairOffer, (_e, offer) => cb(offer));
  },
};

contextBridge.exposeInMainWorld('launcher', api);
