import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { MinecraftSetup } from './MinecraftSetup.ts';

export function registerMinecraftRoutes(router: RouteRegistry, setup: MinecraftSetup): void {
  router.handle(routes.setupMinecraft, () => setup.run());
}
