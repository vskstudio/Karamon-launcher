import { Client } from '@xhayper/discord-rpc';
import type { ServerPing } from '../server/ServerPing';

const APP_ID = '1550981242508410994';
const LARGE_IMAGE_KEY = 'karamon';
const PING_INTERVAL_MS = 60_000;
const RECONNECT_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 4_000;

export type RpcState = 'menu' | 'playing';

export interface DiscordRpcOptions {
  serverHost: string;
  serverPort: number;
  /** Tried when the primary host does not answer a status ping. */
  fallbackHosts?: string[];
  pinger: ServerPing;
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

  constructor(private readonly opts: DiscordRpcOptions) {}

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
    // The game client owns the activity while Minecraft is open, including the
    // live player count. Pushing here would replace that line with the address.
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch {
      /* ignore */
    }
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
      try {
        await this.client?.destroy();
      } catch {
        /* ignore */
      }
      this.client = null;
    } finally {
      this.connecting = false;
    }
  }

  private hosts(): string[] {
    const seen = new Set<string>();
    const hosts: string[] = [];
    for (const host of [this.opts.serverHost, ...(this.opts.fallbackHosts ?? [])]) {
      const trimmed = host.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      hosts.push(trimmed);
    }
    return hosts;
  }

  private async refreshPlayerCount(): Promise<void> {
    for (const host of this.hosts()) {
      try {
        const result = await this.opts.pinger.ping(host, this.opts.serverPort, PING_TIMEOUT_MS);
        if (!result.online) continue;
        this.playerCount = result.players;
        this.push();
        return;
      } catch {
        /* try the next host */
      }
    }
    this.playerCount = null;
    this.push();
  }

  private playersText(): string {
    if (this.playerCount !== null) {
      const word = this.playerCount === 1 ? 'joueur' : 'joueurs';
      return `${this.playerCount} ${word} en ligne · play.karamon.fr`;
    }
    return 'play.karamon.fr';
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
      largeImageText: 'Karamon — play.karamon.fr',
    };
    this.client.user.setActivity(activity).then(
      () => this.opts.log?.(`[Discord] activité: ${this.state} — ${this.playersText()}`),
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
}
