import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArgumentResolver, type ArgumentVars } from './ArgumentResolver.ts';
import { launchIdentity } from './LaunchIdentity.ts';
import type { MojangVersion } from './VersionResolver.ts';

// The string arguments of versions/1.21.1/1.21.1.json (arguments.game).
const MC_1_21_1: MojangVersion = {
  id: '1.21.1',
  arguments: {
    game: [
      '--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}',
      '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}', '--clientId', '${clientid}', '--xuid', '${auth_xuid}',
      '--userType', '${user_type}', '--versionType', '${version_type}',
    ],
    jvm: [],
  },
} as unknown as MojangVersion;

function gameArgs(identity: ReturnType<typeof launchIdentity>): Map<string, string> {
  const vars: ArgumentVars = {
    ...identity,
    versionName: '1.21.1',
    versionType: 'release',
    gameDir: '/jeu',
    assetsRoot: '/assets',
    assetsIndexName: '17',
    classpath: '',
    nativesDir: '',
    launcherName: 'KaramonLauncher',
    launcherVersion: 'test',
  };
  const { game } = ArgumentResolver.resolve(MC_1_21_1, vars);
  const out = new Map<string, string>();
  for (let i = 0; i < game.length; i += 2) out.set(game[i], game[i + 1]);
  return out;
}

test('an offline account launches with its offline UUID, a placeholder token and the legacy user type', () => {
  const args = gameArgs(
    launchIdentity({
      profile: { id: '1c819e17-633a-344c-b509-9ab2be8d1b6d', name: 'Kara_42', kind: 'offline' },
      accessToken: '0',
      userType: 'legacy',
    }),
  );
  assert.equal(args.get('--username'), 'Kara_42');
  assert.equal(args.get('--uuid'), '1c819e17-633a-344c-b509-9ab2be8d1b6d');
  assert.equal(args.get('--accessToken'), '0');
  assert.equal(args.get('--userType'), 'legacy');
  assert.equal(args.get('--xuid'), '');
});

test('a Microsoft account launches as before: dashed Mojang UUID, its token, msa', () => {
  const args = gameArgs(
    launchIdentity({
      profile: { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch', kind: 'microsoft' },
      accessToken: 'eyJ.jeton.minecraft',
      userType: 'msa',
    }),
  );
  assert.equal(args.get('--username'), 'Notch');
  assert.equal(args.get('--uuid'), '069a79f4-44e9-4726-a5be-fca90e38aaf5');
  assert.equal(args.get('--accessToken'), 'eyJ.jeton.minecraft');
  assert.equal(args.get('--userType'), 'msa');
});
