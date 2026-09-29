import { app } from 'electron/main';
import { shell } from 'electron/common';
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo } from 'electron-updater';
import type { UpdateCheckResult, UpdateInfo, UpdateInstall } from '../../../ipc/contract';

export interface AutoUpdaterOptions {
  onReady: (info: UpdateInfo) => void;
}

export class AutoUpdater {
  private static readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly LATEST_RELEASE_URL = 'https://github.com/vskstudio/Karamon-launcher/releases/latest';

  private readonly onReady: (info: UpdateInfo) => void;
  private readonly install: UpdateInstall = process.platform === 'darwin' ? 'download' : 'restart';
  private readyVersion: string | null = null;

  constructor({ onReady }: AutoUpdaterOptions) {
    this.onReady = onReady;
  }

  private get installsInPlace(): boolean {
    return this.install === 'restart';
  }

  start(): void {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = this.installsInPlace;
    autoUpdater.autoInstallOnAppQuit = this.installsInPlace;

    autoUpdater.on(this.installsInPlace ? 'update-downloaded' : 'update-available', (info: ElectronUpdateInfo) => {
      if (info.version === app.getVersion()) return;
      this.readyVersion = info.version;
      this.onReady({ version: info.version, install: this.install });
    });

    autoUpdater.on('error', () => {});

    this.checkQuietly();
    setInterval(() => this.checkQuietly(), AutoUpdater.CHECK_INTERVAL_MS);
  }

  private checkQuietly(): void {
    if (this.readyVersion) return;
    autoUpdater.checkForUpdates().catch(() => {});
  }

  private readyResult(version: string): UpdateCheckResult {
    return this.installsInPlace ? { status: 'downloaded', version } : { status: 'available', version };
  }

  async check(): Promise<UpdateCheckResult> {
    if (!app.isPackaged) return { status: 'unsupported' };
    if (this.readyVersion) return this.readyResult(this.readyVersion);

    return new Promise<UpdateCheckResult>((resolve) => {
      const cleanup = (): void => {
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvail);
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('error', onError);
      };
      const onNotAvail = (): void => {
        cleanup();
        resolve({ status: 'no-update', currentVersion: app.getVersion() });
      };
      const onAvailable = (info: ElectronUpdateInfo): void => {
        cleanup();
        if (this.installsInPlace) {
          resolve({ status: 'downloading', version: info.version });
          return;
        }
        this.readyVersion = info.version;
        resolve(this.readyResult(info.version));
      };
      const onDownloaded = (info: ElectronUpdateInfo): void => {
        cleanup();
        this.readyVersion = info.version;
        resolve(this.readyResult(info.version));
      };
      const onError = (e: Error): void => {
        cleanup();
        resolve({ status: 'error', error: e.message });
      };

      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('update-not-available', onNotAvail);
      autoUpdater.once('update-downloaded', onDownloaded);
      autoUpdater.once('error', onError);

      autoUpdater.checkForUpdates().catch((e) => onError(e as Error));
    });
  }

  installNow(): void {
    if (this.installsInPlace) {
      autoUpdater.quitAndInstall(false, true);
      return;
    }
    void shell.openExternal(AutoUpdater.LATEST_RELEASE_URL);
  }
}
