import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { ServerStatus } from './ServerStatus';

export function registerServerRoutes(router: RouteRegistry, status: ServerStatus): void {
  router.handle(routes.pingServer, () => status.ping());
}
