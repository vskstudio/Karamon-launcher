import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { MinecraftSetup } from './MinecraftSetup';

export function registerMinecraftRoutes(router: RouteRegistry, setup: MinecraftSetup): void {
  router.handle(routes.setupMinecraft, () => setup.run());
}
