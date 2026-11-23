import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import { RangeUnsupportedError, type HttpClient, type RangeRequest } from '../../shared/HttpClient.ts';
import type { AppConfig } from '../../../ipc/contract.ts';
import { ModpackSync } from './ModpackSync.ts';
import { MinecraftLauncher, type LaunchEvents } from '../minecraft/MinecraftLauncher.ts';

export const CDN_BASE = 'https://karamon.fr/downloads/';
export const RELEASE_BASE = 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/';

export interface PackServerOptions {
  base?: string;
  ranges?: boolean;
  releaseDigests?: Record<string, string>;
}

export interface PackServerStats {
  bytes: number;
  downloads: string[];
  heads: string[];
}

export function zipOf(files: Record<string, Buffer | string>): Buffer {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body));
  return zip.toBuffer();
}

export function jarOf(id: string, kb = 0): Buffer {
  return zipOf({ 'fabric.mod.json': JSON.stringify({ id }), 'blob.bin': crypto.randomBytes(kb * 1024) });
}

export function sha1Of(data: Buffer): string {
  return crypto.createHash('sha1').update(data).digest('hex');
}

export class PackServer {
  readonly files = new Map<string, Buffer>();
  readonly stats: PackServerStats = { bytes: 0, downloads: [], heads: [] };
  readonly base: string;
  private readonly ranges: boolean;
  private readonly releaseDigests: Record<string, string> | null;
  private gate: Promise<void> | null = null;

  constructor({ base = CDN_BASE, ranges = true, releaseDigests }: PackServerOptions = {}) {
    this.base = base;
    this.ranges = ranges;
    this.releaseDigests = releaseDigests ?? null;
  }

  resetStats(): void {
    this.stats.bytes = 0;
    this.stats.downloads.length = 0;
    this.stats.heads.length = 0;
  }

  holdDownloads(): () => void {
    let release = (): void => undefined;
    this.gate = new Promise((resolve) => (release = resolve));
    return () => {
      this.gate = null;
      release();
    };
  }

  get http(): HttpClient {
    const fake = {
      head: async (url: string) => {
        const name = this.nameOf(url);
        this.stats.heads.push(name);
        const body = this.body(name);
        return { etag: this.etagOf(name), 'content-length': String(body.length) };
      },
      get: async (url: string) => {
        const body = this.files.get(this.nameOf(url));
        return body ? { status: 200, body } : { status: 404, body: Buffer.alloc(0) };
      },
      getText: async (url: string) => this.body(this.nameOf(url)).toString('utf8'),
      getJson: async (url: string) => {
        if (url.startsWith('https://api.github.com/') && this.releaseDigests) {
          return {
            assets: [...this.files.keys()].map((name, i) => ({
              id: Date.now() + i,
              name,
              size: this.files.get(name)!.length,
              digest: this.releaseDigests![name],
            })),
          };
        }
        throw new Error(`HTTP 404 for ${url}`);
      },
      getRange: async (url: string, r: RangeRequest) => {
        const s = this.slice(url, r);
        return { body: Buffer.from(s.data), start: s.start, total: s.total, etag: s.etag };
      },
      openRange: async (url: string, r: RangeRequest) => {
        await this.gate;
        const s = this.slice(url, r);
        const stream = new PassThrough();
        stream.end(Buffer.from(s.data));
        return { stream, start: s.start, end: s.end, total: s.total, etag: s.etag };
      },
      download: async (url: string, dest: string) => {
        await this.gate;
        const name = this.nameOf(url);
        const body = this.body(name);
        this.stats.bytes += body.length;
        this.stats.downloads.push(name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
      },
    };
    return fake as unknown as HttpClient;
  }

  private nameOf(url: string): string {
    if (!url.startsWith(this.base)) throw new Error(`HTTP 404 for ${url}`);
    return decodeURIComponent(url.slice(this.base.length));
  }

  private body(name: string): Buffer {
    const body = this.files.get(name);
    if (!body) throw new Error(`HTTP 404 pour ${name}`);
    return body;
  }

  private etagOf(name: string): string {
    return `"${sha1Of(this.body(name)).slice(0, 12)}"`;
  }

  private slice(url: string, r: RangeRequest) {
    const name = this.nameOf(url);
    const body = this.body(name);
    if (!this.ranges) throw new RangeUnsupportedError('HTTP 200');
    if (r.ifRange && r.ifRange !== this.etagOf(name)) throw new RangeUnsupportedError('HTTP 200 (changé)');
    const start = r.end === undefined && r.start < 0 ? Math.max(0, body.length + r.start) : r.start;
    const end = r.end === undefined ? body.length - 1 : r.end;
    this.stats.bytes += end - start + 1;
    return { data: body.subarray(start, end + 1), start, end, total: body.length, etag: this.etagOf(name) };
  }
}

export interface PackContents {
  jars: Record<string, Buffer>;
  shaderTxt?: string;
  shaderRevision?: number;
  withManifests?: boolean;
}

export function publishPack(server: PackServer, { jars, shaderTxt = 'shadowDistance=4\n', shaderRevision, withManifests = false }: PackContents): void {
  const ui = zipOf({ 'pack.mcmeta': '{"pack":{"pack_format":34}}' });
  const rp = zipOf({ 'pack.mcmeta': 'rp' });
  const overrides = zipOf({ 'config/lumymon.json': '{"ok":true}' });
  const shader = zipOf({ 'shaders/final.fsh': 'void main(){}', 'shaders.properties': 'x=1' });
  const entry = (name: string, body: Buffer, extra: Record<string, unknown> = {}) => ({
    name,
    size: body.length,
    ...(withManifests ? { sha1: sha1Of(body) } : {}),
    ...extra,
  });
  server.files.set('mods.zip', zipOf(jars));
  server.files.set(
    'assets.zip',
    zipOf({
      'client-options.json': JSON.stringify({
        resourcePacks: ['vanilla', 'file/Comforts.zip', 'file/Karamon UI'],
        shaderPack: 'KARAMON - Shader',
        enableShaders: true,
        ...(shaderRevision === undefined ? {} : { shaderRevision }),
      }),
      ...(withManifests
        ? { 'mods-manifest.json': JSON.stringify(Object.entries(jars).map(([name, body]) => entry(name, body))) }
        : {}),
      'resourcepacks-manifest.json': JSON.stringify([entry('Comforts.zip', rp), entry('Karamon UI.zip', ui, { extract: true })]),
      'shaderpacks-manifest.json': JSON.stringify([
        { name: 'KARAMON - Shader.zip', size: shader.length, extract: true },
        { name: 'KARAMON - Shader.txt', size: Buffer.byteLength(shaderTxt) },
      ]),
      'overrides-manifest.json': JSON.stringify(entry('overrides.zip', overrides)),
      'overrides.zip': overrides,
      'resourcepacks/Comforts.zip': rp,
      'resourcepacks/Karamon UI.zip': ui,
      'shaderpacks/KARAMON - Shader.zip': shader,
      'shaderpacks/KARAMON - Shader.txt': shaderTxt,
    }),
  );
}

export interface FakeGame {
  exit(code?: number): void;
}

export interface LauncherHarness {
  root: string;
  game: string;
  config: AppConfig;
  launcher: MinecraftLauncher;
  games: FakeGame[];
  sync(onStatus?: (line: string) => void): Promise<string[]>;
  play(events?: Partial<LaunchEvents>): Promise<void>;
  cleanup(): void;
}

export function launcherHarness(server: PackServer, { disabledJarPrefixes }: { disabledJarPrefixes?: string[] } = {}): LauncherHarness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-launcher-'));
  const game = path.join(root, 'game');
  const games: FakeGame[] = [];
  const config = {
    mcGameDir: game,
    memoryMb: 6144,
    secondInstanceMemoryMb: 4096,
    javaPath: '',
    jvmArgs: '',
    closeLauncherOnGameStart: false,
    devMode: false,
    potatoMode: false,
    potatoHintDismissed: false,
    disableSodium: false,
    autoSendReports: false,
    server: { host: 'play.karamon.fr', port: 25565 },
  } as AppConfig;
  const launcher = new MinecraftLauncher({
    mcLauncherDir: path.join(root, '.minecraft'),
    defaultInstanceDir: game,
    downloadsBaseUrl: server.base,
    defaultHost: 'play.karamon.fr',
    profileName: 'Karamon',
    minecraftVersion: '1.21.1',
    modpackSync: new ModpackSync({ http: server.http, disabledJarPrefixes }),
    javaProvisioner: { ensure: async () => '/usr/bin/java' },
    gameLauncher: {
      launch: async (_spec, events) => {
        const spawnedAt = Date.now();
        games.push({ exit: (code = 0) => events.onExit(code, spawnedAt) });
      },
    },
  });
  return {
    root,
    game,
    config,
    launcher,
    games,
    async sync(onStatus) {
      const lines: string[] = [];
      await launcher.syncOnly(
        config,
        (line) => {
          lines.push(line);
          onStatus?.(line);
        },
        () => undefined,
      );
      return lines;
    },
    play(events = {}) {
      return launcher.launch(config, {
        onStatus: () => undefined,
        onProgress: () => undefined,
        onLog: () => undefined,
        onExit: () => undefined,
        ...events,
      });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
