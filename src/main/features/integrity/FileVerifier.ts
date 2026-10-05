import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { hasValidZipEnd, isArchiveName } from './ZipTail.ts';

export const INTEGRITY_CACHE_FILE = '.karamon-integrity-cache.json';

export interface ExpectedFile {
  size?: number;
  /** Lowercase hex SHA-1 of the file as stored on disk. */
  sha1?: string;
}

interface HashRecord {
  size: number;
  mtimeMs: number;
  sha1: string;
}

export interface FileVerifierOptions {
  /** Rehash every file, ignoring the size/mtime cache (« Réparer l'installation »). */
  force?: boolean;
}

/**
 * Decides whether an installed pack file is intact. Size always, the zip end
 * record for archives (catches a zero-filled tail even when the cached hash is
 * stale), and the SHA-1 when the manifest gives one. Hashes are cached per file
 * by size + mtime so a normal launch only rehashes what changed.
 */
export class FileVerifier {
  private readonly cachePath: string;
  private readonly root: string;
  private readonly force: boolean;
  private records: Record<string, HashRecord> | null = null;
  private dirty = false;
  private readonly damagedFiles = new Set<string>();

  constructor(gameDir: string, { force = false }: FileVerifierOptions = {}) {
    this.root = path.resolve(gameDir);
    this.cachePath = path.join(gameDir, INTEGRITY_CACHE_FILE);
    this.force = force;
  }

  /** Files found on disk but damaged (wrong size, broken archive, wrong hash). */
  get damaged(): string[] {
    return [...this.damagedFiles];
  }

  async isIntact(filePath: string, expected: ExpectedFile = {}): Promise<boolean> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    const ok = await this.check(filePath, stat, expected);
    if (!ok) this.damagedFiles.add(this.key(filePath));
    return ok;
  }

  /** Persists the hash cache; best-effort. */
  save(): void {
    if (!this.dirty || !this.records) return;
    try {
      writeFileAtomic(this.cachePath, JSON.stringify(this.records));
      this.dirty = false;
    } catch {
      /* best-effort cache */
    }
  }

  private async check(filePath: string, stat: fs.Stats, expected: ExpectedFile): Promise<boolean> {
    if (typeof expected.size === 'number' && stat.size !== expected.size) return false;
    const archiveOk = !isArchiveName(filePath) || hasValidZipEnd(filePath);
    if (!expected.sha1) return archiveOk;
    // A broken zip tail with a cached good hash means the cache is stale
    // (zero-filled after a crash, same size and mtime): rehash to be sure.
    const sha1 = await this.cachedSha1(filePath, stat, !archiveOk);
    return sha1 === expected.sha1.toLowerCase();
  }

  private async cachedSha1(filePath: string, stat: fs.Stats, rehash: boolean): Promise<string> {
    const records = this.load();
    const key = this.key(filePath);
    const known = records[key];
    if (!this.force && !rehash && known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
      return known.sha1;
    }
    const sha1 = await sha1File(filePath);
    records[key] = { size: stat.size, mtimeMs: stat.mtimeMs, sha1 };
    this.dirty = true;
    return sha1;
  }

  private load(): Record<string, HashRecord> {
    if (this.records) return this.records;
    try {
      const raw = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as unknown;
      this.records = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, HashRecord>)
        : {};
    } catch {
      this.records = {};
    }
    return this.records;
  }

  private key(filePath: string): string {
    const rel = path.relative(this.root, path.resolve(filePath));
    return (rel.startsWith('..') || path.isAbsolute(rel) ? path.resolve(filePath) : rel).replace(/\\/g, '/');
  }
}

export function sha1File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
