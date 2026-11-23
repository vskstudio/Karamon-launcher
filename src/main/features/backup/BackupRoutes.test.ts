import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigNotReadYetError } from '../config/Config.ts';
import type { MinecraftLauncher } from '../minecraft/MinecraftLauncher.ts';
import { exclusiveOnReadGameDir } from './BackupRoutes.ts';

test('une sauvegarde est refusée tant que la config n’a pas été lue', async () => {
  const touched: string[] = [];
  const minecraft = { session: () => touched.push('session') } as unknown as Pick<MinecraftLauncher, 'session'>;
  const onGame = exclusiveOnReadGameDir(
    {
      getRead: () => {
        throw new ConfigNotReadYetError();
      },
    },
    minecraft,
  );

  await assert.rejects(
    Promise.resolve().then(() => onGame(async (gameDir) => touched.push(gameDir))),
    ConfigNotReadYetError,
  );
  assert.deepEqual(touched, []);
});
