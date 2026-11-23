import { routes } from '../ipc/contract.ts';
import type { RouteRegistry } from './ipc/IpcRouter.ts';
import type { WindowManager } from './WindowManager.ts';

export function registerWindowRoutes(router: RouteRegistry, window: WindowManager): void {
  router.on(routes.minimize, () => window.minimize());
  router.on(routes.maximize, () => window.toggleMaximize());
  router.on(routes.close, () => window.close());
}
