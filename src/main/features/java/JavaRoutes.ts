import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { JavaDetector } from './JavaDetector.ts';

export function registerJavaRoutes(router: RouteRegistry, javas: Pick<JavaDetector, 'list'>): void {
  router.handle(routes.listJava, () => javas.list());
}
