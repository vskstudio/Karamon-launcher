import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { ServerStatus } from './ServerStatus.ts';

export function registerServerRoutes(router: RouteRegistry, status: ServerStatus): void {
  router.handle(routes.pingServer, () => status.ping());
}
