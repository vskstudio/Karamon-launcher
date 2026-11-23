import type { BrowserWindow } from 'electron/main';
import { shell } from 'electron/common';
import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import { exportLogs, openFolder } from './DesktopShell.ts';
import { readSystemInfo } from './SystemInfo.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

export interface SystemRoutesDeps {
  appVersion: string;
  dataDir: string;
  instance: () => GameInstance;
  window: () => BrowserWindow | null;
}

export function registerSystemRoutes(router: RouteRegistry, deps: SystemRoutesDeps): void {
  router.handle(routes.systemInfo, () => readSystemInfo(deps.appVersion));
  router.handle(routes.openInstance, () => openFolder(deps.instance().dir));
  router.handle(routes.openData, () => openFolder(deps.dataDir));
  router.handle(routes.openExternal, (url) => shell.openExternal(url));
  router.handle(routes.exportLogs, (text) => exportLogs(text, deps.window()));
}
