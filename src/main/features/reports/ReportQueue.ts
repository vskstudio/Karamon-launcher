import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { LauncherReport, QueuedReport, ReportQueueState, ReportTrigger } from './ReportTypes.ts';

const MAX_PENDING_REPORTS = 3;
const AUTO_COOLDOWN_MS = 10 * 60 * 1000;

interface QueueMeta {
  lastAuto: Partial<Record<ReportTrigger, number>>;
}

export class ReportQueue {
  private readonly dir: string;
  private readonly metaFile: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'reports');
    this.metaFile = path.join(this.dir, 'state.json');
  }

  enqueue(report: LauncherReport, state: ReportQueueState, createdAt = Date.now()): QueuedReport {
    const item = { state, createdAt, report } satisfies QueuedReport;
    fs.mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(this.fileFor(item), zlib.gzipSync(Buffer.from(JSON.stringify(item), 'utf8')));
    const all = this.list();
    while (all.length > MAX_PENDING_REPORTS) {
      const oldest = all.shift();
      if (oldest) this.remove(oldest.report.reportId);
    }
    return item;
  }

  list(state?: ReportQueueState): QueuedReport[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((name) => name.endsWith('.json.gz'));
    } catch {
      return [];
    }
    const items: QueuedReport[] = [];
    for (const name of names) {
      try {
        const item = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(this.dir, name))).toString('utf8')) as QueuedReport;
        if (!item?.report?.reportId || !['awaiting-consent', 'approved'].includes(item.state)) continue;
        if (!state || item.state === state) items.push(item);
      } catch {
        // A broken queue entry cannot be sent safely; ignore it.
      }
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }

  approve(reportId: string): QueuedReport | null {
    const item = this.list().find((candidate) => candidate.report.reportId === reportId);
    if (!item) return null;
    this.remove(reportId);
    return this.enqueue(item.report, 'approved', item.createdAt);
  }

  remove(reportId: string): void {
    for (const item of this.list()) {
      if (item.report.reportId !== reportId) continue;
      fs.rmSync(this.fileFor(item), { force: true });
    }
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
    writeFileAtomic(this.metaFile, JSON.stringify(meta));
  }

  private fileFor(item: QueuedReport): string {
    const id = item.report.reportId.replace(/[^A-Za-z0-9-]/g, '_');
    return path.join(this.dir, `${item.createdAt}-${id}.json.gz`);
  }

  private readMeta(): QueueMeta {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) as QueueMeta;
      return { lastAuto: parsed?.lastAuto && typeof parsed.lastAuto === 'object' ? parsed.lastAuto : {} };
    } catch {
      return { lastAuto: {} };
    }
  }
}
