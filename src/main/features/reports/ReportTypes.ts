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
  /** Deleted after this time (TTL). Missing on entries written before the TTL existed. */
  expiresAt?: number;
  /** Failed deliveries so far (#35/#36); missing on older entries, read as 0. */
  failedDeliveries?: number;
  /** Not retried before this time (the panel's Retry-After). */
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
