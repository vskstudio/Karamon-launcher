import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { AutoUpdater } from './AutoUpdater.ts';

export function registerUpdaterRoutes(router: RouteRegistry, updater: AutoUpdater): void {
  router.on(routes.installUpdate, () => updater.installNow());
  router.handle(routes.checkForUpdate, () => updater.check());
}
