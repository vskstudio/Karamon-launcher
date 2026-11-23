import fs from 'fs';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { Deadlines, HttpClient } from '../../shared/HttpClient.ts';

const MANIFEST_FETCH_TIMEOUT_MS = 8000;
const MANIFEST_FRESH_MS = 5 * 60 * 1000;
const REMEMBERED_VERSIONS = 10;
const DATE_FIELDS = ['publishedAt', 'releasedAt', 'date', 'updatedAt'] as const;

export interface PackInfo {
  version: string | null;
  minecraft: string;
  loader: string;
  loaderVersion: string;
  baseName: string | null;
  upToDate: boolean | null;
}

export interface RemotePack {
  version: string;
  minecraft: string;
  loader: string;
  loaderVersion: string;
  baseName: string | null;
  notes: string;
  publishedAt: number | null;
}

export interface SeenPackVersion {
  version: string;
  notes: string;
  publishedAt: number;
}

interface PackVersionsState {
  manifest: RemotePack | null;
  seen: SeenPackVersion[];
  installed: Record<string, string>;
}

export interface BundledPack {
  minecraft: string;
  fabricVersion: string;
}

export interface PackManifestOptions {
  http: Pick<HttpClient, 'get'>;
  manifestUrl: string;
  stateFile: string;
  bundled: BundledPack;
  now?: () => number;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function dateOf(raw: Record<string, unknown>): number | null {
  for (const field of DATE_FIELDS) {
    const value = raw[field];
    const time = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN;
    if (Number.isFinite(time) && time > 0) return time;
  }
  return null;
}

function parsePackManifest(raw: unknown): RemotePack | null {
  if (!raw || typeof raw !== 'object') return null;
  const manifest = raw as Record<string, unknown>;
  const version = text(manifest.version);
  if (!version) return null;
  const base = manifest.baseModpack as Record<string, unknown> | undefined;
  return {
    version,
    minecraft: text(manifest.minecraft),
    loader: text(manifest.loader),
    loaderVersion: text(manifest.loaderVersion),
    baseName: text(base?.name) || null,
    notes: text(manifest.notes),
    publishedAt: dateOf(manifest),
  };
}

function storedPack(raw: unknown): RemotePack | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Record<string, unknown>;
  const version = text(stored.version);
  if (!version) return null;
  return {
    version,
    minecraft: text(stored.minecraft),
    loader: text(stored.loader),
    loaderVersion: text(stored.loaderVersion),
    baseName: text(stored.baseName) || null,
    notes: text(stored.notes),
    publishedAt: typeof stored.publishedAt === 'number' ? stored.publishedAt : null,
  };
}

function emptyState(): PackVersionsState {
  return { manifest: null, seen: [], installed: {} };
}

export class PackManifest {
  private readonly options: PackManifestOptions;
  private readonly now: () => number;
  private state: PackVersionsState | null = null;
  private fresh: { pack: RemotePack; at: number } | null = null;
  private inFlight: Promise<RemotePack | null> | null = null;

  constructor(options: PackManifestOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  latest({ totalTimeoutMs = MANIFEST_FETCH_TIMEOUT_MS }: Pick<Deadlines, 'totalTimeoutMs'> = {}): Promise<RemotePack | null> {
    if (this.fresh && this.now() - this.fresh.at < MANIFEST_FRESH_MS) return Promise.resolve(this.fresh.pack);
    this.inFlight ??= this.fetchLatest(totalTimeoutMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  lastKnown(): RemotePack | null {
    return this.load().manifest;
  }

  seenVersions(): SeenPackVersion[] {
    return [...this.load().seen];
  }

  markInstalled(gameDir: string, version: string): void {
    const state = this.load();
    if (state.installed[gameDir] === version) return;
    state.installed[gameDir] = version;
    this.save(state);
  }

  async info(gameDir: string): Promise<PackInfo> {
    const latest = await this.latest();
    const known = latest ?? this.lastKnown();
    const installed = this.load().installed[gameDir] ?? null;
    return {
      version: installed,
      minecraft: known?.minecraft || this.options.bundled.minecraft,
      loader: known?.loader || 'fabric',
      loaderVersion: known?.loaderVersion || this.options.bundled.fabricVersion,
      baseName: known?.baseName ?? null,
      upToDate: latest && installed ? installed === latest.version : null,
    };
  }

  private async fetchLatest(totalTimeoutMs: number): Promise<RemotePack | null> {
    let pack: RemotePack | null = null;
    try {
      const response = await this.options.http.get(this.options.manifestUrl, { totalTimeoutMs });
      if (response.status >= 200 && response.status < 300) {
        pack = parsePackManifest(JSON.parse(response.body.toString('utf8')));
      }
    } catch {
      pack = null;
    }
    if (!pack) return null;
    this.fresh = { pack, at: this.now() };
    this.remember(pack);
    return pack;
  }

  private remember(pack: RemotePack): void {
    const state = this.load();
    const seen = state.seen.find((entry) => entry.version === pack.version);
    const manifestChanged = JSON.stringify(state.manifest) !== JSON.stringify(pack);
    if (seen && seen.notes === pack.notes && !manifestChanged) return;
    if (seen) {
      seen.notes = pack.notes;
      if (pack.publishedAt) seen.publishedAt = pack.publishedAt;
    } else {
      state.seen.unshift({ version: pack.version, notes: pack.notes, publishedAt: pack.publishedAt ?? this.now() });
      state.seen = state.seen.slice(0, REMEMBERED_VERSIONS);
    }
    state.manifest = pack;
    this.save(state);
  }

  private load(): PackVersionsState {
    if (this.state) return this.state;
    let state = emptyState();
    try {
      const raw = JSON.parse(fs.readFileSync(this.options.stateFile, 'utf8')) as Partial<PackVersionsState>;
      state = {
        manifest: storedPack(raw.manifest),
        seen: Array.isArray(raw.seen)
          ? raw.seen.filter(
              (entry): entry is SeenPackVersion =>
                !!entry && typeof entry.version === 'string' && typeof entry.notes === 'string' && typeof entry.publishedAt === 'number',
            )
          : [],
        installed: raw.installed && typeof raw.installed === 'object' ? { ...raw.installed } : {},
      };
    } catch {
      state = emptyState();
    }
    this.state = state;
    return state;
  }

  private save(state: PackVersionsState): void {
    try {
      writeFileAtomic(this.options.stateFile, JSON.stringify(state));
    } catch {
      return;
    }
  }
}
