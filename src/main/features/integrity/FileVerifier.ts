import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { hasValidZipEnd, isArchiveName } from './ZipTail.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

export interface ExpectedFile {
  size?: number;
  sha1?: string;
}

interface HashRecord {
  size: number;
  mtimeMs: number;
  sha1?: string;
  crc?: number;
}

export interface FileVerifierOptions {
  force?: boolean;
}

export class FileVerifier {
  private readonly cachePath: string;
  private readonly root: string;
  private readonly force: boolean;
  private records: Record<string, HashRecord> | null = null;
  private dirty = false;
  private readonly damagedFiles = new Set<string>();

  constructor(instance: GameInstance, { force = false }: FileVerifierOptions = {}) {
    this.root = path.resolve(instance.dir);
    this.cachePath = instance.integrityCache;
    this.force = force;
  }

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

  save(): string | null {
    if (!this.dirty || !this.records) return null;
    try {
      writeFileAtomic(this.cachePath, JSON.stringify(this.records));
      this.dirty = false;
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async matchesZipEntry(filePath: string, size: number, crc: number): Promise<boolean> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return false;
    }
    if (!stat.isFile() || stat.size !== size) return false;
    if (isArchiveName(filePath) && !hasValidZipEnd(filePath)) return false;
    const records = this.load();
    const key = this.key(filePath);
    const known = records[key];
    const fresh = !this.force && known && known.size === stat.size && known.mtimeMs === stat.mtimeMs;
    if (fresh && typeof known.crc === 'number') return known.crc === crc;
    const actual = await crc32File(filePath);
    records[key] = { ...(fresh ? known : {}), size: stat.size, mtimeMs: stat.mtimeMs, crc: actual };
    this.dirty = true;
    return actual === crc;
  }

  remember(filePath: string, crc: number): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    this.load()[this.key(filePath)] = { size: stat.size, mtimeMs: stat.mtimeMs, crc };
    this.dirty = true;
  }

  private async check(filePath: string, stat: fs.Stats, expected: ExpectedFile): Promise<boolean> {
    if (typeof expected.size === 'number' && stat.size !== expected.size) return false;
    const archiveOk = !isArchiveName(filePath) || hasValidZipEnd(filePath);
    if (!expected.sha1) return archiveOk;
    const sha1 = await this.cachedSha1(filePath, stat, !archiveOk);
    return sha1 === expected.sha1.toLowerCase();
  }

  private async cachedSha1(filePath: string, stat: fs.Stats, rehash: boolean): Promise<string> {
    const records = this.load();
    const key = this.key(filePath);
    const known = records[key];
    const fresh = known && known.size === stat.size && known.mtimeMs === stat.mtimeMs;
    if (!this.force && !rehash && fresh && known.sha1) {
      return known.sha1;
    }
    const sha1 = await sha1File(filePath);
    records[key] = { ...(fresh && !rehash ? known : {}), size: stat.size, mtimeMs: stat.mtimeMs, sha1 };
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

export function crc32File(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let crc = 0;
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => (crc = zlib.crc32(chunk as Buffer, crc)));
    stream.on('error', reject);
    stream.on('end', () => resolve(crc));
  });
}
