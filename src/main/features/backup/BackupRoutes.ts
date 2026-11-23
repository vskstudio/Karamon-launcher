import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { Backup } from './Backup';

export type ExclusiveOnGame = <T>(operation: (gameDir: string) => Promise<T>) => Promise<T>;

export function registerBackupRoutes(router: RouteRegistry, backup: Backup, onGame: ExclusiveOnGame): void {
  router.handle(routes.createBackup, () => onGame((gameDir) => backup.create(gameDir)));
  router.handle(routes.listBackups, () => backup.list());
  router.handle(routes.deleteBackup, (name) => backup.delete(name));
}
