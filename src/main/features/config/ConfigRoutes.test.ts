import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'path';
import { routes } from '../../../ipc/contract.ts';
import type { Handler, RouteRegistry } from '../../ipc/IpcRouter.ts';
import { Config, type AppConfig, type AppConfigUpdate } from './Config.ts';
import { registerConfigRoutes } from './ConfigRoutes.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';

function saveConfigHandler(onChange: (before: AppConfig, after: AppConfig) => Promise<void>): Handler<AppConfigUpdate, AppConfig> {
  const handlers = new Map<string, Handler<never, unknown>>();
  const router: RouteRegistry = {
    handle: (route, handler) => void handlers.set(route.channel, handler as Handler<never, unknown>),
    on: () => undefined,
  };
  const config = new Config(path.join(makeTempDir('karamon-config-routes-'), 'config.json'), () => {}).load();
  registerConfigRoutes(router, { config, onChange });
  return handlers.get(routes.saveConfig.channel) as Handler<AppConfigUpdate, AppConfig>;
}

test('saving the settings answers once the mod toggles are applied', async () => {
  const order: string[] = [];
  const save = saveConfigHandler(async (before, after) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`bascule ${before.potatoMode} -> ${after.potatoMode}`);
  });

  const saved = await save({ potatoMode: true });
  order.push('réponse');

  assert.equal(saved.potatoMode, true);
  assert.deepEqual(order, ['bascule false -> true', 'réponse']);
});

test('a failed mod toggle reaches the caller instead of being an unhandled rejection', async () => {
  const save = saveConfigHandler(async () => {
    throw new Error('mods-disabled verrouillé');
  });
  await assert.rejects(Promise.resolve(save({ potatoMode: true })), /mods-disabled verrouillé/);
});
