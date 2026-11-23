import { Client } from '@xhayper/discord-rpc';
import type { ServerStatus } from '../server/ServerStatus';
import { KARAMON } from '../../shared/KaramonProfile.ts';

const APP_ID = '1550981242508410994';
const LARGE_IMAGE_KEY = 'karamon';
const PING_INTERVAL_MS = 60_000;
const RECONNECT_INTERVAL_MS = 30_000;
const SHOWN_ADDRESS = KARAMON.server.host;

export type RpcState = 'menu' | 'playing';


export interface DiscordRpcOptions {
  status: Pick<ServerStatus, 'ping'>;
  log?: (msg: string) => void;
}

export class DiscordRpc {
  private client: Client | null = null;
  private connected = false;
  private connecting = false;
  private state: RpcState = 'menu';
  private playerCount: number | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private lastLoggedActivity = '';

  private readonly opts: DiscordRpcOptions;

  constructor(opts: DiscordRpcOptions) {
    this.opts = opts;
  }

  start(): void {
    void this.connect();
    void this.refreshPlayerCount();
    this.retryTimer = setInterval(() => {
      if (!this.connected && !this.destroyed) void this.connect();
    }, RECONNECT_INTERVAL_MS);
    this.pingTimer = setInterval(() => void this.refreshPlayerCount(), PING_INTERVAL_MS);
  }

  setMenu(): void {
    this.state = 'menu';
    this.push();
  }

  setPlaying(): void {
    this.state = 'playing';
  }

  setPingPaused(paused: boolean): void {
    if (paused) {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      return;
    }
    if (this.pingTimer || this.destroyed) return;
    void this.refreshPlayerCount();
    this.pingTimer = setInterval(() => void this.refreshPlayerCount(), PING_INTERVAL_MS);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (!this.client) return;
    await this.client.destroy().catch(() => undefined);
    this.client = null;
    this.connected = false;
  }

  private async connect(): Promise<void> {
    if (this.connected || this.connecting || this.destroyed) return;
    this.connecting = true;
    try {
      this.client = new Client({ clientId: APP_ID });
      this.client.on('ready', () => {
        this.connected = true;
        this.opts.log?.(`[Discord] connecté en tant que ${this.client?.user?.username ?? 'inconnu'}`);
        this.push();
      });
      this.client.on('disconnected', () => {
        this.opts.log?.('[Discord] déconnecté');
        this.connected = false;
      });
      await this.client.login();
    } catch (e) {
      this.opts.log?.(`[Discord] connexion impossible : ${(e as Error).message}`);
      this.connected = false;
      await this.client?.destroy().catch(() => undefined);
      this.client = null;
    } finally {
      this.connecting = false;
    }
  }

  private async refreshPlayerCount(): Promise<void> {
    const result = await this.opts.status.ping();
    this.playerCount = result.online ? result.players : null;
    this.push();
  }

  private playersText(): string {
    if (this.playerCount !== null) {
      const word = this.playerCount === 1 ? 'joueur' : 'joueurs';
      return `${this.playerCount} ${word} en ligne · ${SHOWN_ADDRESS}`;
    }
    return SHOWN_ADDRESS;
  }

  private push(): void {
    if (this.state === 'playing') return;
    if (!this.connected || !this.client?.user) return;
    const base = {
      details: 'Sur le launcher',
      state: this.playersText(),
      instance: false,
    };
    const activity = {
      ...base,
      largeImageKey: LARGE_IMAGE_KEY,
      largeImageText: `${KARAMON.profileName} · ${SHOWN_ADDRESS}`,
    };
    this.client.user.setActivity(activity).then(
      () => this.logActivityChange(`[Discord] activité: ${this.state}, ${base.state}`),
      (err: Error) => {
        this.opts.log?.(`[Discord] setActivity échoué (avec image): ${err?.message ?? err}`);
        this.client?.user?.setActivity(base).then(
          () => this.opts.log?.(`[Discord] activité (sans image): ${this.state}`),
          (err2: Error) =>
            this.opts.log?.(`[Discord] setActivity fallback échoué: ${err2?.message ?? err2}`),
        );
      },
    );
  }

  private logActivityChange(line: string): void {
    if (line === this.lastLoggedActivity) return;
    this.lastLoggedActivity = line;
    this.opts.log?.(line);
  }
}
