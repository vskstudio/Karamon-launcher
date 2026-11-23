import { routes } from '../../../ipc/contract.ts';
import type { EventSink, RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { PlayActions, PlayEvents } from './PlayActions.ts';

export function registerPlayRoutes(router: RouteRegistry, actions: PlayActions): void {
  router.handle(routes.play, () => actions.play());
  router.handle(routes.syncMods, () => actions.syncMods());
  router.handle(routes.repair, () => actions.repair());
}

export function playEventsTo(window: EventSink): PlayEvents {
  return {
    consoleLine: (line) => window.emit(routes.onStatus, line),
    gameState: (state) => window.emit(routes.onGameState, state),
    repairOffer: (offer) => window.emit(routes.onRepairOffer, offer),
  };
}
