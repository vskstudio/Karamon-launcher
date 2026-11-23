import { JsonFile, UnreadableFileError, jsonObject, type UnreadableCause } from '../../shared/DurableFile.ts';
import { KARAMON } from '../../../shared/Karamon.ts';

export interface ServerInfo {
  host: string;
  port: number;
}

export interface AppConfig {
  mcGameDir: string;
  memoryMb: number;
  secondInstanceMemoryMb: number;
  javaPath: string;
  jvmArgs: string;
  closeLauncherOnGameStart: boolean;
  devMode: boolean;
  potatoMode: boolean;
  potatoHintDismissed: boolean;
  disableSodium: boolean;
  autoSendReports: boolean;
  server: ServerInfo;
}

export type AppConfigUpdate = Partial<Omit<AppConfig, 'server'>> & {
  server?: Partial<ServerInfo>;
};

const MAX_TEXT_LENGTH = 4096;
const MIN_MEMORY_MB = 512;
const MAX_MEMORY_MB = 1024 * 1024;
const MAX_PORT = 65535;

const DEFAULTS: AppConfig = Object.freeze({
  mcGameDir: '',
  memoryMb: KARAMON.defaultMemoryMb,
  secondInstanceMemoryMb: 6144,
  javaPath: '',
  jvmArgs: '',
  closeLauncherOnGameStart: false,
  devMode: false,
  potatoMode: false,
  potatoHintDismissed: false,
  disableSodium: false,
  autoSendReports: false,
  server: { ...KARAMON.server },
}) as AppConfig;

export type ConfigLog = (message: string) => void;

export class Config {
  private readonly file: JsonFile<AppConfig>;
  private readonly log: ConfigLog;
  private data: AppConfig | null = null;
  private loadedFromDisk = false;
  private unsavedUpdates: AppConfigUpdate[] = [];

  constructor(filePath: string, log: ConfigLog) {
    this.file = new JsonFile(filePath, (raw) => Config.normalize(Config.merge(DEFAULTS, jsonObject(raw) as AppConfigUpdate)), {
      whenUnreadable: 'set-aside',
    });
    this.log = log;
  }

  load(): this {
    const state = this.file.read();
    this.loadedFromDisk = state.kind !== 'unreadable';
    if (state.kind === 'unreadable') this.log(Config.unreadableMessage(this.file.path, state.cause, state.reason));
    this.data = state.kind === 'read' ? state.value : Config.clone(DEFAULTS);
    return this;
  }

  get(): AppConfig {
    if (!this.data) this.load();
    if (!this.loadedFromDisk) this.rereadIfNotLoadedYet();
    return Config.clone(this.data!);
  }

  set(updates: AppConfigUpdate): void {
    if (!this.data) this.load();
    if (!this.loadedFromDisk) this.rereadIfNotLoadedYet();
    this.data = Config.apply(this.data!, updates);
    this.unsavedUpdates.push(updates);
    this.save();
  }

  private rereadIfNotLoadedYet(): void {
    const state = this.file.read();
    if (state.kind === 'unreadable') return;
    if (state.kind === 'read') this.data = this.unsavedUpdates.reduce(Config.apply, state.value);
    this.loadedFromDisk = true;
    if (this.unsavedUpdates.length > 0) this.save();
  }

  private save(): void {
    if (!this.data) return;
    try {
      const { keptUnreadableAs } = this.file.write(this.data);
      this.loadedFromDisk = true;
      this.unsavedUpdates = [];
      if (keptUnreadableAs) this.log(`Config illisible gardée sous ${keptUnreadableAs}`);
    } catch (e) {
      if (!(e instanceof UnreadableFileError)) throw e;
      this.log(`Config pas encore enregistrée, le réglage le sera dès que le fichier pourra être relu : ${e.message}`);
    }
  }

  private static unreadableMessage(file: string, cause: UnreadableCause, reason: string): string {
    if (cause === 'io') {
      return `Config ${file} inaccessible (${reason}), réglages par défaut utilisés pour l'instant, le fichier sera relu dès que possible et jamais écrasé sans avoir été lu`;
    }
    return `Config ${file} illisible (${reason}), réglages par défaut utilisés jusqu'au prochain enregistrement, qui gardera l'ancien fichier à côté`;
  }

  private static apply(base: AppConfig, updates: AppConfigUpdate): AppConfig {
    return Config.normalize(Config.merge(base, updates));
  }

  private static merge(base: AppConfig, raw: AppConfigUpdate): AppConfig {
    const updates: AppConfigUpdate = raw && typeof raw === 'object' ? raw : {};
    return {
      mcGameDir: Config.text(updates.mcGameDir, base.mcGameDir),
      memoryMb: Config.number(updates.memoryMb, base.memoryMb),
      secondInstanceMemoryMb: Config.number(updates.secondInstanceMemoryMb, base.secondInstanceMemoryMb),
      javaPath: Config.text(updates.javaPath, base.javaPath),
      jvmArgs: Config.text(updates.jvmArgs, base.jvmArgs),
      closeLauncherOnGameStart: Config.boolean(
        updates.closeLauncherOnGameStart,
        base.closeLauncherOnGameStart,
      ),
      devMode: Config.boolean(updates.devMode, base.devMode),
      potatoMode: Config.boolean(updates.potatoMode, base.potatoMode),
      potatoHintDismissed: Config.boolean(updates.potatoHintDismissed, base.potatoHintDismissed),
      disableSodium: Config.boolean(updates.disableSodium, base.disableSodium),
      autoSendReports: Config.boolean(updates.autoSendReports, base.autoSendReports),
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
    return {
      ...data,
      memoryMb: Config.memory(data.memoryMb, DEFAULTS.memoryMb),
      secondInstanceMemoryMb: Config.memory(data.secondInstanceMemoryMb, DEFAULTS.secondInstanceMemoryMb),
      server: {
        host: host || DEFAULTS.server.host,
        port: port > 0 && port <= MAX_PORT ? port : DEFAULTS.server.port,
      },
    };
  }

  private static memory(value: number, fallback: number): number {
    const mb = Math.trunc(value);
    return mb >= MIN_MEMORY_MB && mb <= MAX_MEMORY_MB ? mb : fallback;
  }

  private static clone<T>(o: T): T {
    return JSON.parse(JSON.stringify(o)) as T;
  }
}
