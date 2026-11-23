import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import { Screenshots } from './Screenshots.ts';

export function registerScreenshotRoutes(router: RouteRegistry, instance: () => GameInstance): void {
  const screenshots = new Screenshots();
  router.handle(routes.listScreenshots, () => screenshots.list(instance()));
  router.handle(routes.deleteScreenshot, (name) => screenshots.delete(instance(), name));
}
