import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { LauncherReport, QueuedReport, ReportQueueState, ReportTrigger } from './ReportTypes.ts';

const MAX_PENDING_REPORTS = 3;
const AUTO_COOLDOWN_MS = 10 * 60 * 1000;
/** Reports never wait more than a week on the player's disk. */
export const REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MANUAL_WINDOW_MS = 10 * 60 * 1000;
export const MANUAL_MAX_PER_WINDOW = 3;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

interface QueueMeta {
  lastAuto: Partial<Record<ReportTrigger, number>>;
  manualSends: number[];
}

export interface ReportQueueOptions {
  log?: (message: string) => void;
}

/**
 * Reports waiting on disk (consent or delivery), under <dataDir>/reports.
 * Owner-only permissions: the content is masked but still personal.
 */
export class ReportQueue {
  private readonly dir: string;
  private readonly metaFile: string;
  private readonly log: (message: string) => void;

  constructor(dataDir: string, options: ReportQueueOptions = {}) {
    this.dir = path.join(dataDir, 'reports');
    this.metaFile = path.join(this.dir, 'state.json');
    this.log = options.log ?? (() => undefined);
  }

  enqueue(report: LauncherReport, state: ReportQueueState, createdAt = Date.now()): QueuedReport {
    const item: QueuedReport = { state, createdAt, attempts: 0, report };
    this.write(item);
    this.evict(createdAt);
    return item;
  }

  /** Live reports, oldest first. Expired and corrupted entries are deleted on the way. */
  list(state?: ReportQueueState, now = Date.now()): QueuedReport[] {
    const items = this.readAll().filter((item) => {
      if (now - item.createdAt <= REPORT_TTL_MS) return true;
      this.delete(item);
      this.log(`Rapport ${item.report.reportId.slice(0, 8)} expiré, supprimé.`);
      return false;
    });
    return state ? items.filter((item) => item.state === state) : items;
  }

  approve(reportId: string, now = Date.now()): QueuedReport | null {
    const item = this.find(reportId, now);
    if (!item) return null;
    const approved: QueuedReport = { ...item, state: 'approved' };
    this.write(approved);
    return approved;
  }

  recordAttempt(reportId: string, nextAttemptAt: number): QueuedReport | null {
    const item = this.readAll().find((candidate) => candidate.report.reportId === reportId);
    if (!item) return null;
    const updated: QueuedReport = { ...item, attempts: item.attempts + 1, nextAttemptAt };
    this.write(updated);
    return updated;
  }

  remove(reportId: string): void {
    for (const item of this.readAll()) {
      if (item.report.reportId === reportId) this.delete(item);
    }
  }

  /** Consent withdrawn: approved reports not yet delivered must not leave. Returns how many. */
  removeApproved(): number {
    const approved = this.readAll().filter((item) => item.state === 'approved');
    for (const item of approved) this.delete(item);
    return approved.length;
  }

  mayAutoSend(trigger: ReportTrigger, now = Date.now()): boolean {
    if (trigger === 'manual') return true;
    const last = this.readMeta().lastAuto[trigger];
    return typeof last !== 'number' || now - last >= AUTO_COOLDOWN_MS;
  }

  markAutoSent(trigger: ReportTrigger, now = Date.now()): void {
    if (trigger === 'manual') return;
    const meta = this.readMeta();
    meta.lastAuto[trigger] = now;
    this.writeMeta(meta);
  }

  mayManualSend(now = Date.now()): boolean {
    return this.recentManual(this.readMeta(), now).length < MANUAL_MAX_PER_WINDOW;
  }

  markManualSent(now = Date.now()): void {
    const meta = this.readMeta();
    meta.manualSends = [...this.recentManual(meta, now), now];
    this.writeMeta(meta);
  }

  private recentManual(meta: QueueMeta, now: number): number[] {
    return meta.manualSends.filter((at) => now - at < MANUAL_WINDOW_MS);
  }

  /**
   * Cap of MAX_PENDING_REPORTS: expired first, then automatic reports still
   * waiting for consent; manual and approved reports go last, oldest first.
   */
  private evict(now: number): void {
    const items = this.list(undefined, now);
    const order = [
      ...items.filter((item) => item.state === 'awaiting-consent' && item.report.trigger !== 'manual'),
      ...items.filter((item) => item.state === 'awaiting-consent' && item.report.trigger === 'manual'),
      ...items.filter((item) => item.state === 'approved'),
    ];
    for (let excess = items.length - MAX_PENDING_REPORTS; excess > 0; excess--) {
      const victim = order.shift();
      if (!victim) break;
      this.delete(victim);
      this.log(`File pleine : rapport ${victim.report.reportId.slice(0, 8)} supprimé.`);
    }
  }

  private find(reportId: string, now: number): QueuedReport | undefined {
    return this.list(undefined, now).find((candidate) => candidate.report.reportId === reportId);
  }

  private readAll(): QueuedReport[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((name) => name.endsWith('.json.gz'));
    } catch {
      return [];
    }
    const items: QueuedReport[] = [];
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const item = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')) as QueuedReport;
        if (!item?.report?.reportId || typeof item.createdAt !== 'number' || !['awaiting-consent', 'approved'].includes(item.state)) {
          throw new Error('format inattendu');
        }
        items.push({ ...item, attempts: typeof item.attempts === 'number' ? item.attempts : 0 });
      } catch (error) {
        // A broken entry can never be sent safely: drop it instead of failing every read.
        fs.rmSync(file, { force: true });
        this.log(`Rapport en file corrompu (${name}), supprimé : ${(error as Error).message}`);
      }
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }

  private write(item: QueuedReport): void {
    this.ensureDir();
    writeFileAtomic(this.fileFor(item), zlib.gzipSync(Buffer.from(JSON.stringify(item), 'utf8')), FILE_MODE);
  }

  private delete(item: QueuedReport): void {
    fs.rmSync(this.fileFor(item), { force: true });
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: DIR_MODE });
    // A folder created by an older version may be world-readable.
    if (process.platform !== 'win32') fs.chmodSync(this.dir, DIR_MODE);
  }

  private fileFor(item: QueuedReport): string {
    const id = item.report.reportId.replace(/[^A-Za-z0-9-]/g, '_');
    return path.join(this.dir, `${item.createdAt}-${id}.json.gz`);
  }

  private readMeta(): QueueMeta {
    let raw: string;
    try {
      raw = fs.readFileSync(this.metaFile, 'utf8');
    } catch {
      return { lastAuto: {}, manualSends: [] };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<QueueMeta>;
      return {
        lastAuto: parsed?.lastAuto && typeof parsed.lastAuto === 'object' ? parsed.lastAuto : {},
        manualSends: Array.isArray(parsed?.manualSends) ? parsed.manualSends.filter((at) => typeof at === 'number') : [],
      };
    } catch {
      fs.rmSync(this.metaFile, { force: true });
      this.log('État de la file de rapports corrompu, réinitialisé.');
      return { lastAuto: {}, manualSends: [] };
    }
  }

  private writeMeta(meta: QueueMeta): void {
    this.ensureDir();
    writeFileAtomic(this.metaFile, JSON.stringify(meta), FILE_MODE);
  }
}
