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
  playerName?: string;
  files: ReportFile[];
}

export type ReportQueueState = 'awaiting-consent' | 'approved';

export interface QueuedReport {
  state: ReportQueueState;
  createdAt: number;
  report: LauncherReport;
}

export type ReportSendStatus = 'sent' | 'queued' | 'skipped' | 'failed';

export interface ReportSendResult {
  status: ReportSendStatus;
  code?: string;
}
