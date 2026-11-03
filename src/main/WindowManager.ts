import { BrowserWindow, screen } from 'electron/main';
import { shell } from 'electron/common';
import path from 'path';
import type { IpcEventContract } from '../ipc/contract';
import { ASPECT_RATIO, initialWindowSize, minimumWindowSize } from './shared/WindowSize';

/** What identifies a frame across the IPC boundary (WebFrameMain). */
type FrameId = { processId: number; routingId: number };

export class WindowManager {
  private window: BrowserWindow | null = null;

  constructor(private readonly distDir: string, private readonly assetsDir: string) {}

  create(): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const size = initialWindowSize(workArea);
    const min = minimumWindowSize(workArea);
    this.window = new BrowserWindow({
      width: size.width,
      height: size.height,
      minWidth: min.width,
      minHeight: min.height,
      frame: false,
      transparent: false,
      backgroundColor: '#0a0a0a',
      webPreferences: {
        preload: path.join(this.distDir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      icon: path.join(this.assetsDir, process.platform === 'win32' ? 'icon.ico' : 'ui/icon-256.png'),
      show: false,
    });

    this.window.setAspectRatio(ASPECT_RATIO);
    WindowManager.lockNavigation(this.window);
    // Chromium remembers a zoom level per origin, so reset any zoom a previous version left behind.
    const window = this.window;
    window.webContents.on('did-finish-load', () => window.webContents.setZoomFactor(1));
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

  /** True when an IPC call comes from the launcher's own page: main frame of our window, loaded from file:. */
  isOwnSender(
    sender: { id: number; mainFrame?: FrameId } | null | undefined,
    frame?: (FrameId & { url: string }) | null,
  ): boolean {
    if (!this.exists() || !sender || sender.id !== this.window!.webContents.id) return false;
    const main = sender.mainFrame;
    if (!frame || !main || frame.processId !== main.processId || frame.routingId !== main.routingId) return false;
    return frame.url.startsWith('file:');
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
