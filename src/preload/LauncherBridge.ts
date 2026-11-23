import { UNEXPECTED_FAILURE, type AnyRoute, type ApiOf, type IpcOutcome } from '../ipc/Route.ts';

export interface IpcRendererChannels {
  invoke(channel: string, input: unknown): Promise<unknown>;
  send(channel: string): void;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

export function bridgeRoutes<Routes extends Record<string, AnyRoute>>(routes: Routes, ipc: IpcRendererChannels): ApiOf<Routes> {
  const methods = Object.entries(routes).map(([name, route]) => [name, bridgeRoute(route, ipc)]);
  return Object.fromEntries(methods) as ApiOf<Routes>;
}

function bridgeRoute(route: AnyRoute, ipc: IpcRendererChannels): (argument?: unknown) => unknown {
  switch (route.kind) {
    case 'invoke':
      return async (input) => unwrap(await ipc.invoke(route.channel, input).catch(unreachable));
    case 'send':
      return () => ipc.send(route.channel);
    case 'event':
      return (listener) => {
        ipc.on(route.channel, (_event, payload) => (listener as (payload: unknown) => void)(payload));
      };
  }
}

function unwrap(outcome: unknown): unknown {
  const answer = outcome as IpcOutcome<unknown>;
  if (answer.ok) return answer.value;
  throw new Error(answer.message);
}

function unreachable(): never {
  throw new Error(UNEXPECTED_FAILURE);
}
