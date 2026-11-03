import type { CollectReportInput } from './ReportCollector.ts';
import type { ReportQueue } from './ReportQueue.ts';
import type { ReportTransportResult } from './ReportTransport.ts';
import type { LauncherReport, QueuedReport, ReportSendResult, ReportTrigger } from './ReportTypes.ts';

/** Delivery attempts per report before it is dropped. */
export const MAX_SEND_ATTEMPTS = 5;
/** Wait after the n-th failure (unless the panel asks for longer with Retry-After). */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export interface ReportConsentRequest {
  reportId: string;
  trigger: ReportTrigger;
  summary: string[];
}

export interface ReportManagerOptions {
  collector: { collect(input: CollectReportInput): Promise<LauncherReport> };
  queue: Pick<
    ReportQueue,
    | 'enqueue' | 'list' | 'approve' | 'remove' | 'recordAttempt' | 'removeApproved'
    | 'mayAutoSend' | 'markAutoSent' | 'mayManualSend' | 'markManualSent'
  >;
  transport: { send(report: LauncherReport): Promise<ReportTransportResult> };
  context: () => { gameDir: string; ramMb: number };
  autoSend: () => boolean;
  setAutoSend: (value: boolean) => void;
  requestConsent: (request: ReportConsentRequest) => void;
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * Collects, queues and delivers diagnostic reports. Every failure stays in the
 * launcher log: the player is never interrupted by a report that did not leave.
 */
export class ReportManager {
  private readonly options: ReportManagerOptions;
  private readonly inFlight = new Map<string, Promise<ReportSendResult>>();
  private readonly now: () => number;

  constructor(options: ReportManagerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Retries due approved reports and asks again for pending consents. */
  async start(): Promise<void> {
    const now = this.now();
    for (const item of this.options.queue.list('approved', now)) {
      if ((item.nextAttemptAt ?? 0) > now) continue;
      await this.deliver(item);
    }
    for (const item of this.options.queue.list('awaiting-consent', now)) {
      this.ask(item.report);
    }
  }

  async detect(trigger: Exclude<ReportTrigger, 'manual'>, summary: string[]): Promise<ReportSendResult> {
    const now = this.now();
    if (!this.options.queue.mayAutoSend(trigger, now)) return { status: 'skipped', reason: 'cooldown' };
    // Marked before the await: a simultaneous detection of the same type sees the cooldown.
    this.options.queue.markAutoSent(trigger, now);
    const report = await this.collect(trigger, summary);
    if (!report) return collectFailed();
    if (this.options.autoSend()) {
      return await this.deliver(this.options.queue.enqueue(report, 'approved', now));
    }
    this.options.queue.enqueue(report, 'awaiting-consent', now);
    this.ask(report);
    return { status: 'queued', nextAttemptAt: null };
  }

  async sendManual(): Promise<ReportSendResult> {
    const now = this.now();
    if (!this.options.queue.mayManualSend(now)) return { status: 'skipped', reason: 'manual_limit' };
    this.options.queue.markManualSent(now);
    const report = await this.collect('manual', ['Envoi manuel depuis le launcher']);
    if (!report) return collectFailed();
    return await this.deliver(this.options.queue.enqueue(report, 'approved', now));
  }

  /** The renderer only says which report and what the player chose; the state is checked here. */
  async answerConsent(reportId: string, send: boolean, always: boolean): Promise<ReportSendResult> {
    const now = this.now();
    const item = this.options.queue.list('awaiting-consent', now).find((candidate) => candidate.report.reportId === reportId);
    if (!item) return { status: 'skipped', reason: 'unknown_report' };
    if (!send) {
      this.options.queue.remove(reportId);
      this.log(`Rapport ${shortId(item.report)} supprimé à la demande du joueur.`);
      return { status: 'skipped', reason: 'declined' };
    }
    if (always) this.options.setAutoSend(true);
    const approved = this.options.queue.approve(reportId, now);
    if (!approved) return { status: 'skipped', reason: 'unknown_report' };
    return await this.deliver(approved);
  }

  /** Consent withdrawn in Settings: approved reports still waiting must not leave. */
  autoSendDisabled(): void {
    const removed = this.options.queue.removeApproved();
    if (removed > 0) this.log(`Envoi automatique désactivé : ${removed} rapport(s) en attente supprimé(s).`);
  }

  private async collect(trigger: ReportTrigger, summary: string[]): Promise<LauncherReport | null> {
    try {
      return await this.options.collector.collect({ trigger, summary, ...this.options.context() });
    } catch (error) {
      this.log(`Collecte du rapport impossible : ${(error as Error).message}`);
      return null;
    }
  }

  private ask(report: LauncherReport): void {
    this.options.requestConsent({ reportId: report.reportId, trigger: report.trigger, summary: report.summary });
  }

  private async deliver(item: QueuedReport): Promise<ReportSendResult> {
    const id = item.report.reportId;
    const pending = this.inFlight.get(id);
    if (pending) return await pending;
    const attempt = this.attempt(item).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, attempt);
    return await attempt;
  }

  /** One delivery attempt. Never collects: a failed send cannot spawn another report. */
  private async attempt(item: QueuedReport): Promise<ReportSendResult> {
    const { report } = item;
    let outcome: ReportTransportResult;
    try {
      outcome = await this.options.transport.send(report);
    } catch {
      outcome = { kind: 'retry', reason: 'erreur inattendue', retryAfterMs: null };
    }
    if (outcome.kind === 'sent') {
      this.options.queue.remove(report.reportId);
      const supportCode = outcome.serverId ? outcome.serverId.slice(0, 8).toUpperCase() : null;
      this.log(`Rapport ${shortId(report)} accepté par le panel${supportCode ? ` (code ${supportCode})` : ''}.`);
      return { status: 'sent', supportCode };
    }
    if (outcome.kind === 'discard') {
      this.options.queue.remove(report.reportId);
      this.log(`Rapport ${shortId(report)} refusé par le panel (${outcome.reason}), supprimé.`);
      return { status: 'failed', reason: outcome.reason, retryable: false };
    }
    const attempts = item.attempts + 1;
    if (attempts >= MAX_SEND_ATTEMPTS) {
      this.options.queue.remove(report.reportId);
      this.log(`Rapport ${shortId(report)} abandonné après ${attempts} tentatives (${outcome.reason}).`);
      return { status: 'failed', reason: outcome.reason, retryable: false };
    }
    const backoff = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
    const nextAttemptAt = this.now() + Math.max(backoff, outcome.retryAfterMs ?? 0);
    this.options.queue.recordAttempt(report.reportId, nextAttemptAt);
    this.log(`Rapport ${shortId(report)} non envoyé (${outcome.reason}), nouvel essai au prochain lancement.`);
    return { status: 'queued', nextAttemptAt };
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function shortId(report: LauncherReport): string {
  return report.reportId.slice(0, 8);
}

function collectFailed(): ReportSendResult {
  return { status: 'failed', reason: 'collecte impossible', retryable: false };
}
