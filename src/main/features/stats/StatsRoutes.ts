import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { PlayStats } from './PlayStats';

export function registerStatsRoutes(router: RouteRegistry, stats: PlayStats): void {
  router.handle(routes.getStats, () => stats.read());
  router.handle(routes.resetStats, () => stats.reset());
}
