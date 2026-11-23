import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { Wiki } from './Wiki.ts';

export function registerWikiRoutes(router: RouteRegistry, wiki: Wiki): void {
  router.handle(routes.wikiIndex, () => wiki.index());
  router.handle(routes.wikiPage, (slug) => wiki.page(slug));
}
