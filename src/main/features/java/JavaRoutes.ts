import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { InstalledJavas } from './InstalledJavas';

export function registerJavaRoutes(router: RouteRegistry, javas: InstalledJavas): void {
  router.handle(routes.listJava, () => javas.list());
}
