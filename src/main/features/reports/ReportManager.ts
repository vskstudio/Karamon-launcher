import type { CollectReportInput } from './ReportCollector.ts';
import { MAX_FAILED_DELIVERIES, type ReportQueue } from './ReportQueue.ts';
import type { ReportTransportResult } from './ReportTransport.ts';
import type { LauncherReport, ReportSendResult, ReportTrigger } from './ReportTypes.ts';

export interface ReportConsentRequest {
  reportId: string;
  trigger: ReportTrigger;
  summary: string[];
}

export interface ReportManagerOptions {
  collector: { collect(input: CollectReportInput): Promise<LauncherReport> };
  queue: Pick<ReportQueue, 'enqueue' | 'list' | 'approve' | 'remove' | 'recordFailedDelivery' | 'mayAutoSend' | 'markAutoSent'>;
  transport: { send(report: LauncherReport): Promise<ReportTransportResult> };
  context: () => { gameDir: string; ramMb: number };
  autoSend: () => boolean;
  setAutoSend: (value: boolean) => void;
  requestConsent: (request: ReportConsentRequest) => void;
  log?: (message: string) => void;
}

export class ReportManager {
  private readonly options: ReportManagerOptions;
  private readonly inFlight = new Map<string, Promise<ReportSendResult>>();

  constructor(options: ReportManagerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    for (const item of this.options.queue.list('approved')) {
      await this.deliver(item.report);
    }
    for (const item of this.options.queue.list('awaiting-consent')) {
      this.ask(item.report);
    }
  }

  async detect(trigger: Exclude<ReportTrigger, 'manual'>, summary: string[], now = Date.now()): Promise<ReportSendResult> {
    if (!this.options.queue.mayAutoSend(trigger, now)) return { status: 'skipped' };
    try {
      const report = await this.collect(trigger, summary);
      this.options.queue.markAutoSent(trigger, now);
      if (this.options.autoSend()) {
        this.options.queue.enqueue(report, 'approved', now);
        return await this.deliver(report);
      }
      this.options.queue.enqueue(report, 'awaiting-consent', now);
      this.ask(report);
      return result('queued', report);
    } catch (error) {
      this.log(`Collecte du rapport impossible: ${(error as Error).message}`);
      return { status: 'failed' };
    }
  }

  async sendManual(): Promise<ReportSendResult> {
    try {
      const report = await this.collect('manual', ['Envoi manuel depuis le launcher']);
      this.options.queue.enqueue(report, 'approved');
      return await this.deliver(report);
    } catch (error) {
      this.log(`Collecte manuelle impossible: ${(error as Error).message}`);
      return { status: 'failed' };
    }
  }

  async answerConsent(reportId: string, send: boolean, always: boolean): Promise<ReportSendResult> {
    const item = this.options.queue.list('awaiting-consent').find((candidate) => candidate.report.reportId === reportId);
    if (!item) return { status: 'failed' };
    if (!send) {
      this.options.queue.remove(reportId);
      return result('skipped', item.report);
    }
    if (always) this.options.setAutoSend(true);
    this.options.queue.approve(reportId);
    return await this.deliver(item.report);
  }

  private async collect(trigger: ReportTrigger, summary: string[]): Promise<LauncherReport> {
    const context = this.options.context();
    return await this.options.collector.collect({ trigger, summary, ...context });
  }

  private ask(report: LauncherReport): void {
    this.options.requestConsent({ reportId: report.reportId, trigger: report.trigger, summary: report.summary });
  }

  private async deliver(report: LauncherReport): Promise<ReportSendResult> {
    const id = report.reportId;
    const pending = this.inFlight.get(id);
    if (pending) return await pending;
    const attempt = this.attempt(report).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, attempt);
    return await attempt;
  }

  private async attempt(report: LauncherReport): Promise<ReportSendResult> {
    let state: ReportTransportResult;
    try {
      state = await this.options.transport.send(report);
    } catch (error) {
      this.log(`Envoi du rapport ${shortCode(report)} impossible: ${(error as Error).message}`);
      state = 'retry';
    }
    if (state === 'sent') {
      this.options.queue.remove(report.reportId);
      this.log(`Rapport ${shortCode(report)} envoyé.`);
      return result('sent', report);
    }
    if (state === 'discard') {
      this.options.queue.remove(report.reportId);
      this.log(`Rapport ${shortCode(report)} refusé définitivement par le panel.`);
      return result('failed', report);
    }
    const outcome = this.options.queue.recordFailedDelivery(report.reportId);
    if (outcome === 'dropped') {
      this.log(`Rapport ${shortCode(report)} abandonné après ${MAX_FAILED_DELIVERIES} envois ratés.`);
      return result('failed', report);
    }
    if (outcome === 'missing') {
      this.log(`Rapport ${shortCode(report)} retiré de la file pendant son envoi.`);
      return result('failed', report);
    }
    this.log(`Rapport ${shortCode(report)} en attente d'envoi.`);
    return result('queued', report);
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function shortCode(report: LauncherReport): string {
  return report.reportId.slice(0, 8);
}

function result(status: ReportSendResult['status'], report: LauncherReport): ReportSendResult {
  return { status, code: shortCode(report) };
}
