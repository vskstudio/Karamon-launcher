import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { Backup } from './Backup.ts';
import type { Config } from '../config/Config.ts';
import type { MinecraftLauncher } from '../minecraft/MinecraftLauncher.ts';

export type ExclusiveOnGame = <T>(operation: (gameDir: string) => Promise<T>) => Promise<T>;

export function registerBackupRoutes(router: RouteRegistry, backup: Backup, onGame: ExclusiveOnGame): void {
  router.handle(routes.createBackup, () => onGame((gameDir) => backup.create(gameDir)));
  router.handle(routes.listBackups, () => backup.list());
  router.handle(routes.deleteBackup, (name) => backup.delete(name));
}

export function exclusiveOnReadGameDir(config: Pick<Config, 'getRead'>, minecraft: Pick<MinecraftLauncher, 'session'>): ExclusiveOnGame {
  return (operation) => {
    const session = minecraft.session(config.getRead());
    return session.exclusive(() => operation(session.instance.dir));
  };
}
