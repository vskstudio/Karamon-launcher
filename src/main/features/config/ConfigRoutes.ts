import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { AppConfig, Config } from './Config.ts';

export interface ConfigRoutesDeps {
  config: Config;
  onChange: (before: AppConfig, after: AppConfig) => Promise<void>;
  onChangeFailed: (message: string) => void;
}

export function registerConfigRoutes(router: RouteRegistry, { config, onChange, onChangeFailed }: ConfigRoutesDeps): void {
  router.handle(routes.getConfig, () => config.get());
  router.handle(routes.saveConfig, (updates) => {
    const before = config.get();
    config.set(updates);
    const after = config.get();
    onChange(before, after).catch((e: unknown) => {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      onChangeFailed(`Réglages enregistrés, mais leur application aux mods a échoué : ${reason}`);
    });
    return after;
  });
}
