import type { ServerInfo } from '../config/Config.ts';
import type { PingResult } from './ServerPing.ts';

const SERVER_PING_TIMEOUT_MS = 5000;

export interface StatusPinger {
  ping(host: string, port: number, timeoutMs: number): Promise<PingResult>;
}

export interface ServerStatusOptions {
  pinger: StatusPinger;
  server: () => ServerInfo;
  publicServerHost: string;
  statusFallbackHost: string;
}

export class ServerStatus {
  private readonly options: ServerStatusOptions;

  constructor(options: ServerStatusOptions) {
    this.options = options;
  }

  async ping(): Promise<PingResult> {
    const server = this.options.server();
    const host = server.host || this.options.publicServerHost;
    const results = this.candidateHosts(host).map((candidate) =>
      this.options.pinger.ping(candidate, server.port, SERVER_PING_TIMEOUT_MS),
    );
    return await firstOnline(results);
  }

  private candidateHosts(host: string): string[] {
    const normalized = host.trim().toLowerCase();
    const hosts = [normalized];
    if (normalized === this.options.publicServerHost) hosts.unshift(this.options.statusFallbackHost);
    return [...new Set(hosts)];
  }
}

function firstOnline(results: Promise<PingResult>[]): Promise<PingResult> {
  return new Promise((resolve) => {
    let remaining = results.length;
    const settle = (answer: PingResult): void => {
      if (answer.online) resolve(answer);
      else if (--remaining === 0) resolve({ online: false });
    };
    for (const result of results) {
      result.then(settle, () => settle({ online: false }));
    }
  });
}
