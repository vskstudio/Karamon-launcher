import { clipboard } from 'electron/main';
import { shell } from 'electron/common';
import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { CrashReports } from './CrashReports';

export function registerCrashRoutes(router: RouteRegistry, crashes: CrashReports, instanceDir: () => string): void {
  router.handle(routes.listCrashes, () => crashes.list(instanceDir()));
  router.handle(routes.readCrash, (name) => crashes.read(instanceDir(), name));
  router.handle(routes.deleteCrash, (name) => crashes.delete(instanceDir(), name));
  router.handle(routes.copyCrash, (name) => clipboard.writeText(crashes.read(instanceDir(), name)));
  router.handle(routes.revealCrash, (name) => shell.showItemInFolder(crashes.reportPath(instanceDir(), name)));
}
