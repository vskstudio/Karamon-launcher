import { JsonFile, jsonObject } from '../../shared/DurableFile.ts';

export interface PlayStatsData {
  totalPlayMs: number;
  sessions: number;
  lastPlayedAt: number | null;
  firstPlayedAt: number | null;
}

const EMPTY: PlayStatsData = {
  totalPlayMs: 0,
  sessions: 0,
  lastPlayedAt: null,
  firstPlayedAt: null,
};

export class PlayStats {
  private readonly file: JsonFile<PlayStatsData>;
  private sessionStart: number | null = null;

  constructor(statsFile: string) {
    this.file = new JsonFile(statsFile, PlayStats.decode, {
      whenUnreadable: 'set-aside',
      indented: false,
    });
  }

  read(): PlayStatsData {
    const state = this.file.read();
    return state.kind === 'read' ? state.value : { ...EMPTY };
  }

  startSession(): void {
    const stats = this.readForUpdate();
    if (!stats) {
      this.sessionStart = null;
      return;
    }
    this.sessionStart = Date.now();
    if (!stats.firstPlayedAt) stats.firstPlayedAt = this.sessionStart;
    stats.lastPlayedAt = this.sessionStart;
    stats.sessions = stats.sessions + 1;
    this.write(stats);
  }

  endSession(): PlayStatsData {
    if (!this.sessionStart) return this.read();
    const stats = this.readForUpdate();
    if (!stats) {
      this.sessionStart = null;
      return this.read();
    }
    stats.totalPlayMs += Date.now() - this.sessionStart;
    this.sessionStart = null;
    this.write(stats);
    return stats;
  }

  reset(): PlayStatsData {
    this.write({ ...EMPTY });
    return { ...EMPTY };
  }

  private readForUpdate(): PlayStatsData | null {
    const state = this.file.read();
    if (state.kind === 'unreadable' && state.cause === 'io') return null;
    return state.kind === 'read' ? state.value : { ...EMPTY };
  }

  private write(data: PlayStatsData): void {
    try {
      this.file.write(data);
    } catch {
      return;
    }
  }

  private static decode(raw: unknown): PlayStatsData {
    const data = jsonObject(raw);
    return {
      totalPlayMs: typeof data.totalPlayMs === 'number' ? data.totalPlayMs : 0,
      sessions: typeof data.sessions === 'number' ? data.sessions : 0,
      lastPlayedAt: typeof data.lastPlayedAt === 'number' ? data.lastPlayedAt : null,
      firstPlayedAt: typeof data.firstPlayedAt === 'number' ? data.firstPlayedAt : null,
    };
  }
}
