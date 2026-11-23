import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigNotReadYetError } from '../config/Config.ts';
import { MinecraftSetup, type MinecraftSetupOptions } from './MinecraftSetup.ts';

test('au démarrage, une config pas encore lue fait sauter l’installation sans rien écrire', async () => {
  const writes: string[] = [];
  const setup = new MinecraftSetup({
    config: {
      getRead: () => {
        throw new ConfigNotReadYetError();
      },
    },
    minecraft: {
      instanceDir: () => writes.push('instanceDir'),
      ensureServerLists: () => writes.push('servers.dat'),
    },
    fabric: { ensureVersion: async () => writes.push('fabric'), versionId: 'fabric' },
    launcherProfile: { ensure: () => writes.push('launcher_profiles.json') },
    launcherDir: '/nulle-part',
    pack: { statusFallbackHost: 'play.karamon.fr', profileName: 'Karamon' },
  } as unknown as MinecraftSetupOptions);

  const result = await setup.run();

  assert.deepEqual(writes, []);
  assert.equal(result.ok, false);
  assert.match(result.details, /Tes réglages sont illisibles pour l'instant/);
});
