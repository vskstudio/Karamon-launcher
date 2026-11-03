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
/** Failed deliveries before a report is dropped (#35/#36). */
export const MAX_FAILED_DELIVERIES = 5;

export type FailedDeliveryOutcome = 'counted' | 'dropped' | 'missing';
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
  /** reportId -> file it was last read from or written to. */
  private readonly sourceFiles = new Map<string, string>();

  constructor(dataDir: string, options: ReportQueueOptions = {}) {
    this.dir = path.join(dataDir, 'reports');
    this.metaFile = path.join(this.dir, 'state.json');
    this.log = options.log ?? (() => undefined);
  }

  enqueue(report: LauncherReport, state: ReportQueueState, createdAt = Date.now()): QueuedReport {
    const item: QueuedReport = { state, createdAt, expiresAt: createdAt + REPORT_TTL_MS, failedDeliveries: 0, report };
    this.write(item);
    this.evict(createdAt, report.reportId);
    return item;
  }

  /** Live reports, oldest first. Expired and corrupted entries are deleted on the way. */
  list(state?: ReportQueueState, now = Date.now()): QueuedReport[] {
    const items = this.readAll().filter((item) => {
      if (now <= (item.expiresAt ?? now)) return true;
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

  /**
   * Counts a failed delivery; drops the report at MAX_FAILED_DELIVERIES.
   * `missing`: the report left the queue meanwhile (declined, consent withdrawn).
   */
  recordFailedDelivery(reportId: string, nextAttemptAt?: number): FailedDeliveryOutcome {
    const item = this.readAll().find((candidate) => candidate.report.reportId === reportId);
    if (!item) return 'missing';
    const failedDeliveries = (item.failedDeliveries ?? 0) + 1;
    if (failedDeliveries >= MAX_FAILED_DELIVERIES) {
      this.remove(reportId);
      return 'dropped';
    }
    const updated: QueuedReport = { ...item, failedDeliveries };
    if (nextAttemptAt === undefined) delete updated.nextAttemptAt;
    else updated.nextAttemptAt = nextAttemptAt;
    this.write(updated);
    return 'counted';
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
    // A date in the future (clock moved back) must not lock the button.
    return meta.manualSends.filter((at) => at <= now && now - at < MANUAL_WINDOW_MS);
  }

  /**
   * Cap of MAX_PENDING_REPORTS: expired first, then automatic reports still
   * waiting for consent; manual and approved reports go last, oldest first.
   * The report just added is never the victim.
   */
  private evict(now: number, keepId: string): void {
    const items = this.list(undefined, now);
    const candidates = items.filter((item) => item.report.reportId !== keepId);
    const order = [
      ...candidates.filter((item) => item.state === 'awaiting-consent' && item.report.trigger !== 'manual'),
      ...candidates.filter((item) => item.state === 'awaiting-consent' && item.report.trigger === 'manual'),
      ...candidates.filter((item) => item.state === 'approved'),
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
        this.sourceFiles.set(item.report.reportId, file);
        if (typeof item.expiresAt !== 'number') {
          // Written before the TTL existed: a week from now, persisted so it does not slide.
          item.expiresAt = Date.now() + REPORT_TTL_MS;
          this.write(item);
        }
        items.push({ ...item, failedDeliveries: typeof item.failedDeliveries === 'number' ? item.failedDeliveries : 0 });
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
    const target = this.fileFor(item);
    writeFileAtomic(target, zlib.gzipSync(Buffer.from(JSON.stringify(item), 'utf8')), FILE_MODE);
    const previous = this.sourceFiles.get(item.report.reportId);
    if (previous && previous !== target) fs.rmSync(previous, { force: true });
    this.sourceFiles.set(item.report.reportId, target);
  }

  /** Deletes the file the entry was read from, even if its name no longer matches the content. */
  private delete(item: QueuedReport): void {
    const id = item.report.reportId;
    fs.rmSync(this.sourceFiles.get(id) ?? this.fileFor(item), { force: true });
    this.sourceFiles.delete(id);
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
