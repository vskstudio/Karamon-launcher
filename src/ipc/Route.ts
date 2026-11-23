import { nothing, type Decoder } from './RequestDecoders.ts';

export interface InvokeRoute<Input, Output> {
  readonly kind: 'invoke';
  readonly channel: string;
  readonly decode: Decoder<Input>;
  readonly answers?: () => Output;
}

export interface SendRoute {
  readonly kind: 'send';
  readonly channel: string;
}

export interface EventRoute<Payload> {
  readonly kind: 'event';
  readonly channel: string;
  readonly carries?: () => Payload;
}

export type AnyRoute = InvokeRoute<unknown, unknown> | SendRoute | EventRoute<unknown>;

export type IpcOutcome<Output> = { ok: true; value: Output } | { ok: false; message: string };

export const UNEXPECTED_FAILURE = 'Le launcher n’a pas pu traiter la demande. Redémarre-le si ça continue.';

interface InvokeRouteBuilder<Input> {
  returns<Output>(): InvokeRoute<Input, Output>;
}

export function invoke(channel: string): InvokeRouteBuilder<void>;
export function invoke<Input>(channel: string, decode: Decoder<Input>): InvokeRouteBuilder<Input>;
export function invoke(channel: string, decode: Decoder<unknown> = nothing): InvokeRouteBuilder<unknown> {
  return { returns: () => ({ kind: 'invoke', channel, decode }) };
}

export function send(channel: string): SendRoute {
  return { kind: 'send', channel };
}

export function event<Payload>(channel: string): EventRoute<Payload> {
  return { kind: 'event', channel };
}

type InvokeMethod<Input, Output> = [Input] extends [void] ? () => Promise<Output> : (input: Input) => Promise<Output>;

export type ApiMethod<R> =
  R extends InvokeRoute<infer Input, infer Output>
    ? InvokeMethod<Input, Output>
    : R extends SendRoute
      ? () => void
      : R extends EventRoute<infer Payload>
        ? (listener: (payload: Payload) => void) => void
        : never;

export type ApiOf<Routes> = { [Name in keyof Routes]: ApiMethod<Routes[Name]> };
