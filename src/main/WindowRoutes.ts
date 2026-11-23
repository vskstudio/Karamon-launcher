import { routes } from '../ipc/contract';
import type { RouteRegistry } from './ipc/IpcRouter';
import type { WindowManager } from './WindowManager';

export function registerWindowRoutes(router: RouteRegistry, window: WindowManager): void {
  router.on(routes.minimize, () => window.minimize());
  router.on(routes.maximize, () => window.toggleMaximize());
  router.on(routes.close, () => window.close());
}
