import path from 'path';
import os from 'os';

export class Paths {
  readonly dataDir: string;
  readonly authCache: string;
  readonly accountsFile: string;
  readonly configFile: string;
  readonly versionsDir: string;
  readonly librariesDir: string;
  readonly assetsDir: string;
  readonly cacheDir: string;
  readonly logsDir: string;
  readonly launcherLog: string;
  readonly backupsDir: string;
  readonly reportsDir: string;
  readonly statsFile: string;
  readonly packVersionsFile: string;
  readonly wikiCacheDir: string;
  private readonly instancesDir: string;
  private readonly runtimeDir: string;

  constructor(rootDir: string) {
    this.dataDir = rootDir;
    this.authCache = path.join(rootDir, 'auth.json');
    this.accountsFile = path.join(rootDir, 'accounts.json');
    this.configFile = path.join(rootDir, 'config.json');
    this.versionsDir = path.join(rootDir, 'versions');
    this.librariesDir = path.join(rootDir, 'libraries');
    this.assetsDir = path.join(rootDir, 'assets');
    this.cacheDir = path.join(rootDir, 'cache');
    this.logsDir = path.join(rootDir, 'logs');
    this.launcherLog = path.join(this.logsDir, 'launcher.log');
    this.backupsDir = path.join(rootDir, 'backups');
    this.reportsDir = path.join(rootDir, 'reports');
    this.statsFile = path.join(rootDir, 'stats.json');
    this.packVersionsFile = path.join(rootDir, 'pack-versions.json');
    this.wikiCacheDir = path.join(this.cacheDir, 'wiki');
    this.instancesDir = path.join(rootDir, 'instances');
    this.runtimeDir = path.join(rootDir, 'runtime');
  }

  instanceDir(name: string): string {
    return path.join(this.instancesDir, name);
  }

  javaRuntimeDir(major: number): string {
    return path.join(this.runtimeDir, `jre-${major}`);
  }

  nativesDir(versionId: string): string {
    return path.join(this.versionsDir, versionId, 'natives');
  }

  static default(): Paths {
    return new Paths(path.join(Paths.userDataRoot(), '.karamon-launcher'));
  }

  static minecraftLauncherDir(): string {
    return Paths.byPlatform({
      darwin: path.join(Paths.userDataRoot(), 'minecraft'),
      win32: path.join(Paths.userDataRoot(), '.minecraft'),
      other: path.join(os.homedir(), '.minecraft'),
    });
  }

  private static userDataRoot(): string {
    return Paths.byPlatform({
      darwin: path.join(os.homedir(), 'Library', 'Application Support'),
      win32: path.join(os.homedir(), 'AppData', 'Roaming'),
      other: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    });
  }

  private static byPlatform(choices: { darwin: string; win32: string; other: string }): string {
    if (process.platform === 'darwin') return choices.darwin;
    if (process.platform === 'win32') return choices.win32;
    return choices.other;
  }
}
