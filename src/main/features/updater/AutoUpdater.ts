import { app } from 'electron/main';
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo } from 'electron-updater';
import type { UpdateCheckResult, UpdateInfo } from '../../../ipc/contract';

export interface AutoUpdaterOptions {
  onReady: (info: UpdateInfo) => void;
}

export class AutoUpdater {
  // Launchers often stay open for hours, so a release pushed meanwhile must still reach them.
  private static readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;

  private readonly onReady: (info: UpdateInfo) => void;
  private downloadedVersion: string | null = null;

  constructor({ onReady }: AutoUpdaterOptions) {
    this.onReady = onReady;
  }

  start(): void {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    // Players who ignore the update bar still get the new version the next time they close.
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      if (info.version === app.getVersion()) return;
      this.downloadedVersion = info.version;
      this.onReady({ version: info.version });
    });

    autoUpdater.on('error', () => {
      /* silent */
    });

    this.checkQuietly();
    setInterval(() => this.checkQuietly(), AutoUpdater.CHECK_INTERVAL_MS);
  }

  private checkQuietly(): void {
    if (this.downloadedVersion) return;
    autoUpdater.checkForUpdates().catch(() => {
      /* silent if no network */
    });
  }

  async check(): Promise<UpdateCheckResult> {
    if (!app.isPackaged) return { status: 'unsupported' };
    if (this.downloadedVersion) {
      return { status: 'downloaded', version: this.downloadedVersion };
    }

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
        resolve({ status: 'downloading', version: info.version });
      };
      const onDownloaded = (info: ElectronUpdateInfo): void => {
        cleanup();
        this.downloadedVersion = info.version;
        resolve({ status: 'downloaded', version: info.version });
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
    autoUpdater.quitAndInstall(false, true);
  }
}
