import { UNEXPECTED_FAILURE, type AnyRoute, type EventRoute, type InvokeRoute, type IpcOutcome, type SendRoute } from '../../ipc/Route.ts';

export type Handler<Input, Output> = (input: Input) => Output | Promise<Output>;

export interface RouteRegistry {
  handle<Input, Output>(route: InvokeRoute<Input, Output>, handler: Handler<Input, NoInfer<Output>>): void;
  on(route: SendRoute, handler: () => void): void;
}

export interface EventSink {
  emit<Payload>(route: EventRoute<Payload>, payload: NoInfer<Payload>): void;
}

export interface IpcMainChannels {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
  on(channel: string, listener: (event: unknown) => void): unknown;
}

export class IpcRouter implements RouteRegistry {
  private readonly ipc: IpcMainChannels;
  private readonly claimed = new Set<string>();

  constructor(ipc: IpcMainChannels) {
    this.ipc = ipc;
  }

  handle<Input, Output>(route: InvokeRoute<Input, Output>, handler: Handler<Input, NoInfer<Output>>): void {
    this.claim(route.channel);
    this.ipc.handle(route.channel, (_event, input) => answer(route, handler, input));
  }

  on(route: SendRoute, handler: () => void): void {
    this.claim(route.channel);
    this.ipc.on(route.channel, () => handler());
  }

  unhandled(routes: Record<string, AnyRoute>): string[] {
    return Object.entries(routes)
      .filter(([, route]) => route.kind !== 'event' && !this.claimed.has(route.channel))
      .map(([name]) => name);
  }

  private claim(channel: string): void {
    if (this.claimed.has(channel)) throw new Error(`Canal IPC ${channel} enregistré deux fois.`);
    this.claimed.add(channel);
  }
}

async function answer<Input, Output>(
  route: InvokeRoute<Input, Output>,
  handler: Handler<Input, Output>,
  input: unknown,
): Promise<IpcOutcome<Output>> {
  try {
    return { ok: true, value: await handler(route.decode(input)) };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : UNEXPECTED_FAILURE };
  }
}
