import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { GameInstance, ModsListResult } from '../../shared/GameInstance.ts';
import type { PackManifest } from './PackManifest.ts';

export interface ModpackRoutesDeps {
  packManifest: PackManifest;
  instance: () => GameInstance;
  listMods: () => ModsListResult;
}

export function registerModpackRoutes(router: RouteRegistry, { packManifest, instance, listMods }: ModpackRoutesDeps): void {
  router.handle(routes.listMods, () => listMods());
  router.handle(routes.packInfo, () => packManifest.info(instance().dir));
}
