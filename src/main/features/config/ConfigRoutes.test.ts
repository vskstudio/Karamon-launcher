import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { routes } from '../../../ipc/contract.ts';
import type { Handler, RouteRegistry } from '../../ipc/IpcRouter.ts';
import { Config, ConfigNotReadYetError, type AppConfig, type AppConfigUpdate } from './Config.ts';
import { registerConfigRoutes } from './ConfigRoutes.ts';
import { makeTempDir } from '../../shared/TempDir.fixture.ts';
import { cannotMakeFilesInaccessible, makeAccessible, makeInaccessible } from '../../shared/Inaccessible.fixture.ts';

function saveConfigHandler(
  onChange: (before: AppConfig, after: AppConfig) => Promise<void>,
  onChangeFailed: (message: string) => void = () => undefined,
  file: string = path.join(makeTempDir('karamon-config-routes-'), 'config.json'),
): { save: Handler<AppConfigUpdate, AppConfig>; file: string } {
  const handlers = new Map<string, Handler<never, unknown>>();
  const router: RouteRegistry = {
    handle: (route, handler) => void handlers.set(route.channel, handler as Handler<never, unknown>),
    on: () => undefined,
  };
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

test('saving is refused while the config cannot be read, then a save after rereading applies the toggle', { skip: cannotMakeFilesInaccessible }, async () => {
  const file = path.join(makeTempDir('karamon-config-routes-'), 'config.json');
  const original = JSON.stringify({ mcGameDir: 'D:\\Jeux\\Karamon' });
  fs.writeFileSync(file, original, 'utf8');
  const toggles: string[] = [];
  makeInaccessible(file);
  const { save } = saveConfigHandler(
    async (before, after) => {
      toggles.push(`${before.potatoMode} -> ${after.potatoMode}`);
    },
    () => undefined,
    file,
  );

  await assert.rejects(Promise.resolve().then(() => save({ potatoMode: true })), ConfigNotReadYetError);
  makeAccessible(file);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(toggles, []);

  const saved = await save({ potatoMode: true });
  assert.equal(saved.mcGameDir, 'D:\\Jeux\\Karamon');
  assert.equal(saved.potatoMode, true);
  assert.deepEqual(toggles, ['false -> true']);
  assert.equal(new Config(file, () => {}).load().get().potatoMode, true);
});
