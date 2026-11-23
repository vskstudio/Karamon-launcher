import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routes } from '../../../ipc/contract.ts';
import type { Handler, RouteRegistry } from '../../ipc/IpcRouter.ts';
import { ConfigNotReadYetError } from '../config/Config.ts';
import { registerAuthRoutes, type AuthRoutesDeps } from './AuthRoutes.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';

test('changer ou remettre un skin hors ligne est refusé tant que la config n’a pas été lue', async () => {
  const handlers = new Map<string, Handler<never, unknown>>();
  const router: RouteRegistry = {
    handle: (route, handler) => void handlers.set(route.channel, handler as Handler<never, unknown>),
    on: () => undefined,
  };
  const readableInstance = new GameInstance(makeTempDir('karamon-auth-routes-'));
  registerAuthRoutes(router, {
    auth: {},
    skins: {},
    instance: () => readableInstance,
    instanceToWrite: () => {
      throw new ConfigNotReadYetError();
    },
    log: () => undefined,
  } as unknown as AuthRoutesDeps);
  const call = (channel: string, input: unknown) => Promise.resolve().then(() => (handlers.get(channel) as Handler<unknown, unknown>)(input));

  await assert.rejects(call(routes.skinOfflineSet.channel, { name: 'Zoe_42', png: '', model: 'classic' }), ConfigNotReadYetError);
  await assert.rejects(call(routes.skinOfflineReset.channel, 'Zoe_42'), ConfigNotReadYetError);
});
