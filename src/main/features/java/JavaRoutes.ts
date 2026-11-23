import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { JavaDetector } from './JavaDetector';

export function registerJavaRoutes(router: RouteRegistry, javas: Pick<JavaDetector, 'list'>): void {
  router.handle(routes.listJava, () => javas.list());
}
