import { DevMode } from '../../shared/DevMode.ts';
import type { KaramonProfile } from '../../shared/KaramonProfile.ts';
import { ConfigNotReadYetError, type AppConfig, type Config } from '../config/Config.ts';
import type { FabricInstaller } from './FabricInstaller.ts';
import type { LauncherProfile } from './LauncherProfile.ts';
import type { MinecraftLauncher, ServerListSetupResult } from './MinecraftLauncher.ts';

export interface SetupResult {
  ok: boolean;
  details: string;
  path: string;
}

export interface MinecraftSetupOptions {
  config: Pick<Config, 'getRead'>;
  minecraft: MinecraftLauncher;
  fabric: FabricInstaller;
  launcherProfile: LauncherProfile;
  launcherDir: string;
  pack: Pick<KaramonProfile, 'statusFallbackHost' | 'profileName'>;
}

export class MinecraftSetup {
  private readonly options: MinecraftSetupOptions;

  constructor(options: MinecraftSetupOptions) {
    this.options = options;
  }

  async run(): Promise<SetupResult> {
    const { config, minecraft, fabric, launcherProfile, launcherDir, pack } = this.options;
    let cfg: AppConfig;
    try {
      cfg = config.getRead();
    } catch (e) {
      if (!(e instanceof ConfigNotReadYetError)) throw e;
      return { ok: false, details: `${e.message} Rien n'a été écrit.`, path: '' };
    }
    const gameDir = minecraft.instanceDir(cfg);
    const host = cfg.server?.host || pack.statusFallbackHost;
    const results: string[] = [];
    let ok = true;

    const serverResults = minecraft.ensureServerLists(gameDir, host, pack.profileName, DevMode.enabled(cfg.devMode));
    const serverErrors = serverResults.filter((r): r is Extract<ServerListSetupResult, { ok: false }> => !r.ok);
    if (serverErrors.length === 0) {
      results.push(`servers.dat OK (${serverResults.length} emplacement(s))`);
    } else {
      ok = false;
      results.push('servers.dat ERREUR ' + serverErrors.map((r) => `${r.dir}: ${r.error}`).join('; '));
    }

    try {
      await fabric.ensureVersion(launcherDir);
      results.push('Fabric OK');
    } catch (e) {
      ok = false;
      results.push('Fabric ERREUR ' + (e as Error).message);
    }

    try {
      launcherProfile.ensure({
        name: pack.profileName,
        versionId: fabric.versionId,
        gameDir,
        memoryMb: cfg.memoryMb,
        jvmArgs: cfg.jvmArgs,
      });
      results.push('Profil OK');
    } catch (e) {
      ok = false;
      results.push('Profil ERREUR ' + (e as Error).message);
    }

    return { ok, details: results.join(' | '), path: gameDir };
  }
}
