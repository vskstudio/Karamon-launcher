import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'path';
import { routes } from '../../../ipc/contract.ts';
import type { Handler, RouteRegistry } from '../../ipc/IpcRouter.ts';
import { Config, type AppConfig, type AppConfigUpdate } from './Config.ts';
import { registerConfigRoutes } from './ConfigRoutes.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';

function saveConfigHandler(
  onChange: (before: AppConfig, after: AppConfig) => Promise<void>,
  onChangeFailed: (message: string) => void = () => undefined,
): { save: Handler<AppConfigUpdate, AppConfig>; file: string } {
  const handlers = new Map<string, Handler<never, unknown>>();
  const router: RouteRegistry = {
    handle: (route, handler) => void handlers.set(route.channel, handler as Handler<never, unknown>),
    on: () => undefined,
  };
  const file = path.join(makeTempDir('karamon-config-routes-'), 'config.json');
  const config = new Config(file, () => {}).load();
  registerConfigRoutes(router, { config, onChange, onChangeFailed });
  return { save: handlers.get(routes.saveConfig.channel) as Handler<AppConfigUpdate, AppConfig>, file };
}

test('saving the settings answers as soon as they are on disk, without waiting for the mod toggles', async () => {
  let releaseToggle = (): void => undefined;
  const toggleHeld = new Promise<void>((resolve) => (releaseToggle = resolve));
  const { save, file } = saveConfigHandler(() => toggleHeld);

  const saved = await save({ potatoMode: true });

  assert.equal(saved.potatoMode, true);
  assert.equal(new Config(file, () => {}).load().get().potatoMode, true);
  releaseToggle();
});

test('a failed mod toggle is reported to the player as such, not as a failed save', async () => {
  const reported: string[] = [];
  let failed = (): void => undefined;
  const reportedOnce = new Promise<void>((resolve) => (failed = resolve));
  const { save } = saveConfigHandler(
    async () => {
      throw new Error('mods-disabled verrouillé');
    },
    (message) => {
      reported.push(message);
      failed();
    },
  );

  const saved = await save({ potatoMode: true });
  await reportedOnce;

  assert.equal(saved.potatoMode, true);
  assert.deepEqual(reported, ['Réglages enregistrés, mais leur application aux mods a échoué : mods-disabled verrouillé']);
});
