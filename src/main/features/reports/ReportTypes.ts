export type ReportTrigger = 'crash_early' | 'crash' | 'sync_failed' | 'launch_failed' | 'manual';

export interface ReportFile {
  name: string;
  content: string;
}

export interface LauncherReport {
  reportId: string;
  launcherVersion: string;
  packVersion: string;
  os: string;
  arch: string;
  javaVersion: string;
  ramMb: number;
  gpu?: string;
  trigger: ReportTrigger;
  summary: string[];
  files: ReportFile[];
}

export type ReportQueueState = 'awaiting-consent' | 'approved';

export interface QueuedReport {
  state: ReportQueueState;
  createdAt: number;
  /** Failed delivery attempts so far. */
  attempts: number;
  /** Not retried before this time (Retry-After, backoff). */
  nextAttemptAt?: number;
  report: LauncherReport;
}

export type ReportSkipReason = 'cooldown' | 'manual_limit' | 'declined' | 'unknown_report';

/** Outcome of a report action, as seen by the renderer. */
export type ReportSendResult =
  | { status: 'sent'; supportCode: string | null }
  | { status: 'queued'; nextAttemptAt: number | null }
  | { status: 'skipped'; reason: ReportSkipReason }
  | { status: 'failed'; reason: string; retryable: boolean };
