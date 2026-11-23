import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { AppConfig, Config } from './Config.ts';

export interface ConfigRoutesDeps {
  config: Config;
  onChange: (before: AppConfig, after: AppConfig) => void;
}

export function registerConfigRoutes(router: RouteRegistry, { config, onChange }: ConfigRoutesDeps): void {
  router.handle(routes.getConfig, () => config.get());
  router.handle(routes.saveConfig, (updates) => {
    const before = config.get();
    config.set(updates);
    const after = config.get();
    onChange(before, after);
    return after;
  });
}
