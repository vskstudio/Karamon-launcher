import { BrowserWindow } from 'electron/main';
import { shell } from 'electron/common';
import path from 'path';
import type { IpcEventContract } from '../ipc/contract';

export class WindowManager {
  private window: BrowserWindow | null = null;

  constructor(private readonly distDir: string, private readonly assetsDir: string) {}

  create(): BrowserWindow {
    this.window = new BrowserWindow({
      width: 1100,
      height: 680,
      minWidth: 900,
      minHeight: 580,
      frame: false,
      transparent: false,
      backgroundColor: '#0a0e1a',
      webPreferences: {
        preload: path.join(this.distDir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      icon: path.join(this.assetsDir, 'icon.ico'),
      show: false,
    });

    WindowManager.lockNavigation(this.window);
    this.window.loadFile(path.join(this.distDir, 'index.html'));
    this.window.once('ready-to-show', () => this.window?.show());
    this.window.on('closed', () => {
      this.window = null;
    });
    return this.window;
  }

  private static lockNavigation(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  }

  current(): BrowserWindow | null {
    return this.window;
  }

  exists(): boolean {
    return !!this.window && !this.window.isDestroyed();
  }

  minimize(): void {
    this.window?.minimize();
  }

  toggleMaximize(): void {
    if (!this.window) return;
    if (this.window.isMaximized()) this.window.unmaximize();
    else this.window.maximize();
  }

  close(): void {
    this.window?.close();
  }

  send<K extends keyof IpcEventContract>(channel: K, payload: IpcEventContract[K]): void {
    if (this.exists()) {
      this.window!.webContents.send(channel, payload);
    }
  }
}
