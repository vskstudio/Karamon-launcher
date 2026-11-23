import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { Backup } from './Backup';

export function registerBackupRoutes(router: RouteRegistry, backup: Backup, instanceDir: () => string): void {
  router.handle(routes.createBackup, () => backup.create(instanceDir()));
  router.handle(routes.listBackups, () => backup.list());
  router.handle(routes.deleteBackup, (name) => backup.delete(name));
}
