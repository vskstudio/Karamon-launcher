import { DevMode } from '../../shared/DevMode.ts';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron/main';
import { Paths } from '../../shared/Paths.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import type { ActiveSession, AuthSession } from '../auth/AuthSession.ts';
import { VersionResolver, type MojangVersion } from './VersionResolver.ts';
import { LibraryDownloader } from './LibraryDownloader.ts';
import { AssetDownloader } from './AssetDownloader.ts';
import { ArgumentResolver } from './ArgumentResolver.ts';
import { launchIdentity } from './LaunchIdentity.ts';
import { FabricInstaller } from './FabricInstaller.ts';
import { forEachOutputLine } from './OutputLines.ts';
import { KARAMON } from '../../../shared/Karamon.ts';

export interface GameLauncherOptions {
  paths: Paths;
  http: HttpClient;
  auth: AuthSession;
  mcVersion: string;
  fabricVersion: string;
}

export interface LaunchSpec {
  javaPath: string;
  memoryMb: number;
  jvmArgs: string;
  gameDir: string;
  devMode?: boolean;
}

export interface LaunchEvents {
  onStatus: (msg: string) => void;
  onProgress: (fraction: number) => void;
  onExit: (code: number | null, spawnedAt: number) => void;
  onLog: (line: string) => void;
}

export class GameLauncher {
  private readonly resolver: VersionResolver;
  private readonly libraries: LibraryDownloader;
  private readonly assets: AssetDownloader;
  private readonly fabric: FabricInstaller;
  private readonly opts: GameLauncherOptions;
  private readonly accountsInGame = new Set<string>();

  constructor(opts: GameLauncherOptions) {
    this.opts = opts;
    this.resolver = new VersionResolver(opts.http, opts.paths);
    this.libraries = new LibraryDownloader(opts.http);
    this.assets = new AssetDownloader(opts.http);
    this.fabric = new FabricInstaller({ mcVersion: opts.mcVersion, fabricVersion: opts.fabricVersion, http: opts.http });
  }

  async launch(spec: LaunchSpec, events: LaunchEvents): Promise<void> {
    events.onStatus('Authentification...');
    const session = await this.opts.auth.getActive();
    const account = session.profile.id;
    if (this.accountsInGame.has(account)) {
      throw new Error(`${session.profile.name} est déjà en jeu : change de compte pour lancer une autre instance.`);
    }
    this.accountsInGame.add(account);
    let child: ChildProcess;
    try {
      events.onStatus('Préparation de la version...');
      const version = await this.installVersion(events);

      events.onStatus('Construction de la commande...');
      const args = this.buildArgs(version, spec, session);

      events.onProgress(1);
      events.onStatus('Lancement de Minecraft...');
      child = spawn(spec.javaPath, args, {
        cwd: spec.gameDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      this.accountsInGame.delete(account);
      throw e;
    }
    const spawnedAt = Date.now();
    child.unref();
    if (child.stdout) forEachOutputLine(child.stdout, events.onLog);
    if (child.stderr) forEachOutputLine(child.stderr, events.onLog);
    let exited = false;
    const exit = (code: number | null): void => {
      if (exited) return;
      exited = true;
      this.accountsInGame.delete(account);
      events.onExit(code, spawnedAt);
    };
    child.on('exit', (code) => exit(code));
    child.on('error', (err) => {
      events.onLog(`Erreur Java: ${err.message}`);
      exit(-1);
    });
  }

  private async installVersion(events: LaunchEvents): Promise<MojangVersion> {
    const fabricText = await this.fabric.profileJson(this.opts.paths.versionsDir);

    const version = await this.resolver.resolveFromText(fabricText);

    const clientJarPath = path.join(
      this.opts.paths.versionsDir,
      version.jar ?? version.id,
      `${version.jar ?? version.id}.jar`,
    );
    if (!fs.existsSync(clientJarPath) && version.downloads?.client) {
      events.onStatus('Téléchargement du client Minecraft...');
      events.onProgress(0.05);
      await this.opts.http.download(version.downloads.client.url, clientJarPath, {
        expectedSha1: version.downloads.client.sha1,
        label: 'client.jar',
      });
    }

    events.onStatus('Téléchargement des librairies...');
    await this.libraries.downloadAll(version.libraries ?? [], this.opts.paths.librariesDir, (frac, label) => {
      events.onProgress(0.1 + frac * 0.3);
      events.onLog(`Librairies: ${label}`);
    });

    events.onStatus('Extraction des natives...');
    const nativesDir = this.opts.paths.nativesDir(version.id);
    await this.libraries.extractNatives(version.libraries ?? [], this.opts.paths.librariesDir, nativesDir);
    events.onProgress(0.45);

    if (version.assetIndex) {
      events.onStatus('Téléchargement des assets...');
      await this.assets.download(version.assetIndex, this.opts.paths.assetsDir, (frac, label) => {
        events.onProgress(0.45 + frac * 0.5);
        events.onLog(label);
      });
    }

    return version;
  }

  private buildArgs(version: MojangVersion, spec: LaunchSpec, session: ActiveSession): string[] {
    const cpEntries = this.libraries.classpath(version.libraries ?? [], this.opts.paths.librariesDir);
    const clientJarPath = path.join(
      this.opts.paths.versionsDir,
      version.jar ?? version.id,
      `${version.jar ?? version.id}.jar`,
    );
    cpEntries.push(clientJarPath);
    const classpath = cpEntries.join(path.delimiter);

    const heapArgs = [`-Xmx${spec.memoryMb}m`, '-Xms512m'];
    const userJvm = (spec.jvmArgs || '').split(/\s+/).filter(Boolean);
    if (spec.devMode) userJvm.push(DevMode.KARAMON_MOD_SERVER_BROWSER_JVM_FLAG);

    const vars = {
      ...launchIdentity(session),
      versionName: version.id,
      versionType: version.type ?? 'release',
      gameDir: spec.gameDir,
      assetsRoot: this.opts.paths.assetsDir,
      assetsIndexName: version.assets ?? version.assetIndex?.id ?? 'legacy',
      classpath,
      nativesDir: this.opts.paths.nativesDir(version.id),
      launcherName: KARAMON.launcherName,
      launcherVersion: app.getVersion(),
    };

    const { jvm, game } = ArgumentResolver.resolve(version, vars);
    if (!version.mainClass) throw new Error('Version sans mainClass: JSON corrompu');

    return [...heapArgs, ...userJvm, ...jvm, version.mainClass, ...game];
  }
}
