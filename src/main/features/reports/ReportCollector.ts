import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { SessionEvidence, readFileTail, trimToTail } from '../crashes/SessionEvidence.ts';
import { redactReportText } from './ReportRedactor.ts';
import type { LauncherReport, ReportFile, ReportTrigger } from './ReportTypes.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

const KIB = 1024;
const MIB = 1024 * KIB;
export const MAX_REPORT_JSON_BYTES = 5 * MIB;
const SUMMARY_MAX_TAGS = 20;
const SUMMARY_TAG_LENGTH = 200;
const PANEL_FILE_NAME_MAX = 128;

function panelFileLimit(name: string): number | undefined {
  if (name.length > PANEL_FILE_NAME_MAX || name.includes('..') || !/^[A-Za-z0-9._-]+$/.test(name)) return undefined;
  if (name === 'launcher.log') return 256 * KIB;
  if (name === 'latest.log') return 512 * KIB;
  if ((name.startsWith('crash-') && name.endsWith('.txt')) || (name.startsWith('hs_err_pid') && name.endsWith('.log'))) return MIB;
  return undefined;
}

export interface ReportCollectorOptions {
  launcherLog: string;
  launcherVersion: string;
  bundledPackVersion: string;
  getPackVersion?: () => Promise<string | undefined>;
  getJavaVersion?: () => Promise<string | undefined>;
  getGpu?: () => Promise<string | undefined>;
  getPlayerName?: () => string | undefined;
  platform?: string;
  arch?: string;
  homeDir?: string;
  localNames?: string[];
  uuid?: () => string;
}

export interface CollectReportInput {
  trigger: ReportTrigger;
  summary: string[];
  instance: GameInstance;
  ramMb: number;
  since?: number;
}

export class ReportCollector {
  private readonly options: ReportCollectorOptions;

  constructor(options: ReportCollectorOptions) {
    this.options = options;
  }

  async collect(input: CollectReportInput): Promise<LauncherReport> {
    const [packVersion, javaVersion, gpu] = await Promise.all([
      this.optional(this.options.getPackVersion, this.options.bundledPackVersion),
      this.optional(this.options.getJavaVersion, 'inconnu'),
      this.optional(this.options.getGpu, undefined),
    ]);
    const redact = this.redactor();
    const files = this.collectFiles(input.instance, redact, input.since ?? 0);
    const playerName = this.options.getPlayerName?.();
    const report: LauncherReport = {
      reportId: (this.options.uuid ?? crypto.randomUUID)(),
      launcherVersion: this.options.launcherVersion,
      packVersion: packVersion || this.options.bundledPackVersion,
      os: this.options.platform ?? process.platform,
      arch: this.options.arch ?? process.arch,
      javaVersion: javaVersion || 'inconnu',
      ramMb: input.ramMb,
      trigger: input.trigger,
      summary: input.summary
        .map((tag) => redact(tag).trim().slice(0, SUMMARY_TAG_LENGTH))
        .filter((tag) => tag.length > 0)
        .slice(0, SUMMARY_MAX_TAGS),
      files,
      ...(gpu ? { gpu: redact(gpu) } : {}),
      ...(playerName ? { playerName } : {}),
    };
    return fitReport(report);
  }

  private collectFiles(instance: GameInstance, redact: (text: string) => string, since: number): ReportFile[] {
    const evidence = new SessionEvidence(instance, since);
    const acceptedByPanel = (file: string): boolean => panelFileLimit(path.basename(file)) !== undefined;
    const candidates = [
      this.options.launcherLog,
      evidence.latestLog(),
      evidence.crashReports().find(acceptedByPanel),
      evidence.hsErrLogs().find(acceptedByPanel),
    ];
    const files: ReportFile[] = [];
    for (const file of candidates) {
      if (!file) continue;
      const name = path.basename(file);
      const limit = panelFileLimit(name);
      if (limit === undefined) continue;
      const content = readFileTail(file, limit);
      if (!content) continue;
      files.push({ name, content: trimToTail(redact(content), limit) });
    }
    return files;
  }

  private redactor(): (text: string) => string {
    const homeDir = this.options.homeDir ?? os.homedir();
    const localNames = this.options.localNames ?? localMachineNames();
    return (text) => redactReportText(text, homeDir, localNames);
  }

  private async optional<T>(getter: (() => Promise<T | undefined>) | undefined, fallback: T): Promise<T> {
    if (!getter) return fallback;
    try {
      return (await getter()) ?? fallback;
    } catch {
      return fallback;
    }
  }
}

function localMachineNames(): string[] {
  const names = [os.hostname().replace(/\.local$/i, '')];
  try {
    names.push(os.userInfo().username);
  } catch {
    return names;
  }
  return names;
}

function fitReport(report: LauncherReport): LauncherReport {
  const files = report.files.map((file) => ({ ...file }));
  const result = { ...report, files };
  const size = (): number => Buffer.byteLength(JSON.stringify(result));

  while (size() > MAX_REPORT_JSON_BYTES) {
    const largeOptional = files
      .filter((file) => file.name.startsWith('hs_err_pid') || file.name.endsWith('.txt'))
      .sort((a, b) => Buffer.byteLength(b.content) - Buffer.byteLength(a.content))[0];
    if (!largeOptional || Buffer.byteLength(largeOptional.content) < 2) break;
    largeOptional.content = tailString(largeOptional.content, Math.floor(Buffer.byteLength(largeOptional.content) / 2));
  }
  for (const prefix of ['hs_err_pid', '.txt']) {
    if (size() <= MAX_REPORT_JSON_BYTES) break;
    const index = files.findIndex((file) => prefix === '.txt' ? file.name.endsWith(prefix) : file.name.startsWith(prefix));
    if (index >= 0) files.splice(index, 1);
  }
  while (size() > MAX_REPORT_JSON_BYTES && files.length > 0) {
    const largest = [...files].sort((a, b) => Buffer.byteLength(b.content) - Buffer.byteLength(a.content))[0];
    if (Buffer.byteLength(largest.content) < 2) {
      files.splice(files.indexOf(largest), 1);
    } else {
      largest.content = tailString(largest.content, Math.floor(Buffer.byteLength(largest.content) / 2));
    }
  }
  return result;
}

function tailString(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  const tail = buffer.subarray(Math.max(0, buffer.length - maxBytes));
  let start = 0;
  while (start < tail.length && (tail[start] & 0xc0) === 0x80) start++;
  return tail.subarray(start).toString('utf8');
}
