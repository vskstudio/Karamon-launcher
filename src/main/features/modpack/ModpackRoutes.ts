import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { ModsListResult } from '../../shared/GameInstance';
import type { PackManifest } from './PackManifest';

export interface ModpackRoutesDeps {
  packManifest: PackManifest;
  instanceDir: () => string;
  listMods: () => ModsListResult;
}

export function registerModpackRoutes(router: RouteRegistry, { packManifest, instanceDir, listMods }: ModpackRoutesDeps): void {
  router.handle(routes.listMods, () => listMods());
  router.handle(routes.packInfo, () => packManifest.info(instanceDir()));
}
