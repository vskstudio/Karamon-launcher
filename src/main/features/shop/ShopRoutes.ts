import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { Shop } from './Shop';

export function registerShopRoutes(router: RouteRegistry, shop: Shop): void {
  router.handle(routes.shopCatalog, () => shop.catalog());
  router.handle(routes.shopCheckout, (offerId) => shop.checkout(offerId));
  router.handle(routes.shopPortal, () => shop.openPortal());
}
