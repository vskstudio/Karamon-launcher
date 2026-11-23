import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { Shop } from './Shop.ts';

export function registerShopRoutes(router: RouteRegistry, shop: Shop): void {
  router.handle(routes.shopCatalog, () => shop.catalog());
  router.handle(routes.shopCheckout, (offerId) => shop.checkout(offerId));
  router.handle(routes.shopPortal, () => shop.openPortal());
}
