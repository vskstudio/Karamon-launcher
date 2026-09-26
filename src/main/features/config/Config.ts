import fs from 'fs';
import path from 'path';
import type { AppConfig, AppConfigUpdate } from '../../../ipc/contract';

const MAX_TEXT_LENGTH = 4096;
const MIN_MEMORY_MB = 512;
const MAX_MEMORY_MB = 1024 * 1024;
const MAX_PORT = 65535;

const DEFAULTS: AppConfig = Object.freeze({
  mcGameDir: '',
  minecraftLauncherPath: '',
  memoryMb: 12288,
  javaPath: '',
  jvmArgs: '',
  closeLauncherOnGameStart: false,
  devMode: false,
  server: { host: 'play.karamon.fr', port: 25565 },
  theme: 'red',
}) as AppConfig;

export class Config {
  private readonly filePath: string;
  private data: AppConfig | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): this {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as AppConfigUpdate;
        this.data = Config.normalize(Config.merge(DEFAULTS, raw));
        return this;
      }
    } catch {
      /* fall through to defaults */
    }
    this.data = Config.clone(DEFAULTS);
    return this;
  }

  save(): void {
    if (!this.data) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get(): AppConfig {
    if (!this.data) this.load();
    return Config.clone(this.data!);
  }

  set(updates: AppConfigUpdate): void {
    if (!this.data) this.load();
    this.data = Config.normalize(Config.merge(this.data!, updates));
    this.save();
  }

  private static merge(base: AppConfig, raw: AppConfigUpdate): AppConfig {
    const updates: AppConfigUpdate = raw && typeof raw === 'object' ? raw : {};
    return {
      mcGameDir: Config.text(updates.mcGameDir, base.mcGameDir),
      minecraftLauncherPath: Config.text(updates.minecraftLauncherPath, base.minecraftLauncherPath),
      memoryMb: Config.number(updates.memoryMb, base.memoryMb),
      javaPath: Config.text(updates.javaPath, base.javaPath),
      jvmArgs: Config.text(updates.jvmArgs, base.jvmArgs),
      closeLauncherOnGameStart: Config.boolean(
        updates.closeLauncherOnGameStart,
        base.closeLauncherOnGameStart,
      ),
      devMode: Config.boolean(updates.devMode, base.devMode),
      theme: updates.theme === 'red' || updates.theme === 'gold' ? updates.theme : base.theme,
      server: {
        host: Config.text(updates.server?.host, base.server.host),
        port: Config.number(updates.server?.port, base.server.port),
      },
    };
  }

  private static text(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : fallback;
  }

  private static number(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private static boolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private static normalize(data: AppConfig): AppConfig {
    const host = data.server.host.trim();
    const port = Math.trunc(data.server.port);
    const memoryMb = Math.trunc(data.memoryMb);
    return {
      ...data,
      memoryMb:
        memoryMb >= MIN_MEMORY_MB && memoryMb <= MAX_MEMORY_MB ? memoryMb : DEFAULTS.memoryMb,
      server: {
        host: host || DEFAULTS.server.host,
        port: port > 0 && port <= MAX_PORT ? port : DEFAULTS.server.port,
      },
    };
  }

  private static clone<T>(o: T): T {
    return JSON.parse(JSON.stringify(o)) as T;
  }
}
