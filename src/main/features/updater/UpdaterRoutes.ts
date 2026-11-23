import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { AutoUpdater } from './AutoUpdater';

export function registerUpdaterRoutes(router: RouteRegistry, updater: AutoUpdater): void {
  router.on(routes.installUpdate, () => updater.installNow());
  router.handle(routes.checkForUpdate, () => updater.check());
}
