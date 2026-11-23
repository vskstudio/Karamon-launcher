import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import { Screenshots } from './Screenshots';

export function registerScreenshotRoutes(router: RouteRegistry, instanceDir: () => string): void {
  const screenshots = new Screenshots();
  router.handle(routes.listScreenshots, () => screenshots.list(instanceDir()));
  router.handle(routes.deleteScreenshot, (name) => screenshots.delete(instanceDir(), name));
}
