import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import { ModpackSync } from './ModpackSync';
import type { PackManifest } from './PackManifest';

export interface ModpackRoutesDeps {
  packManifest: PackManifest;
  instanceDir: () => string;
}

export function registerModpackRoutes(router: RouteRegistry, { packManifest, instanceDir }: ModpackRoutesDeps): void {
  router.handle(routes.listMods, () => ModpackSync.listMods(instanceDir()));
  router.handle(routes.packInfo, () => packManifest.info(instanceDir()));
}
