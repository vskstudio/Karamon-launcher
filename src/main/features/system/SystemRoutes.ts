import type { BrowserWindow } from 'electron/main';
import { shell } from 'electron/common';
import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import { exportLogs, openFolder } from './DesktopShell';
import { readSystemInfo } from './SystemInfo';

export interface SystemRoutesDeps {
  appVersion: string;
  dataDir: string;
  instanceDir: () => string;
  window: () => BrowserWindow | null;
}

export function registerSystemRoutes(router: RouteRegistry, deps: SystemRoutesDeps): void {
  router.handle(routes.systemInfo, () => readSystemInfo(deps.appVersion));
  router.handle(routes.openInstance, () => openFolder(deps.instanceDir()));
  router.handle(routes.openData, () => openFolder(deps.dataDir));
  router.handle(routes.openExternal, (url) => shell.openExternal(url));
  router.handle(routes.exportLogs, (text) => exportLogs(text, deps.window()));
}
