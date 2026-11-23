import { routes } from '../../ipc/contract.ts';
import type { LauncherApi } from '../../ipc/contract.ts';
import type { EventSink, RouteRegistry } from './IpcRouter.ts';

export function mistypedRoutesDoNotCompile(router: RouteRegistry, window: EventSink, api: LauncherApi): void {
  router.handle(routes.readCrash, (name: string) => name);
  // @ts-expect-error
  router.handle(routes.readCrash, (name: number) => String(name));
  // @ts-expect-error
  router.handle(routes.readCrash, () => 42);
  // @ts-expect-error
  router.handle(routes.listJava, async () => 'java');
  // @ts-expect-error
  router.on(routes.getConfig, () => undefined);

  window.emit(routes.onProgress, 0.5);
  // @ts-expect-error
  window.emit(routes.onProgress, 'moitié');

  void api.readCrash('crash-1.txt');
  // @ts-expect-error
  void api.readCrash();
  // @ts-expect-error
  void api.getConfig('inattendu');
}
