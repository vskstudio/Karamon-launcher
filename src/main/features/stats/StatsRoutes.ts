import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { PlayStats } from './PlayStats.ts';

export function registerStatsRoutes(router: RouteRegistry, stats: PlayStats): void {
  router.handle(routes.getStats, () => stats.read());
  router.handle(routes.resetStats, () => stats.reset());
}
