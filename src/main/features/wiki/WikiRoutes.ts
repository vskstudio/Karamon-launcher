import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { Wiki } from './Wiki';

export function registerWikiRoutes(router: RouteRegistry, wiki: Wiki): void {
  router.handle(routes.wikiIndex, () => wiki.index());
  router.handle(routes.wikiPage, (slug) => wiki.page(slug));
}
