import { clipboard } from 'electron/main';
import { shell } from 'electron/common';
import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import type { CrashReports } from './CrashReports.ts';

export function registerCrashRoutes(router: RouteRegistry, crashes: CrashReports, instance: () => GameInstance): void {
  router.handle(routes.listCrashes, () => crashes.list(instance()));
  router.handle(routes.readCrash, (name) => crashes.read(instance(), name));
  router.handle(routes.deleteCrash, (name) => crashes.delete(instance(), name));
  router.handle(routes.copyCrash, (name) => clipboard.writeText(crashes.read(instance(), name)));
  router.handle(routes.revealCrash, (name) => shell.showItemInFolder(crashes.reportPath(instance(), name)));
}
