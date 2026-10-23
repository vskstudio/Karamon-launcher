import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { redactReportText } from './ReportRedactor.ts';
import type { LauncherReport, ReportFile, ReportTrigger } from './ReportTypes.ts';

const KIB = 1024;
const MIB = 1024 * KIB;
export const MAX_REPORT_JSON_BYTES = 5 * MIB;
const SUMMARY_MAX_TAGS = 20;
const SUMMARY_TAG_LENGTH = 200;

export interface ReportCollectorOptions {
  dataDir: string;
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
  gameDir: string;
  ramMb: number;
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
    const files = this.collectFiles(input.gameDir, redact);
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

  private collectFiles(gameDir: string, redact: (text: string) => string): ReportFile[] {
    const candidates: Array<{ file: string | null; limit: number }> = [
      { file: path.join(this.options.dataDir, 'logs', 'launcher.log'), limit: 256 * KIB },
      { file: path.join(gameDir, 'logs', 'latest.log'), limit: 512 * KIB },
      { file: newestFile(path.join(gameDir, 'crash-reports'), (name) => /^crash-.*\.txt$/i.test(name)), limit: MIB },
      { file: newestFile(gameDir, (name) => /^hs_err_pid\d+\.log$/i.test(name)), limit: MIB },
    ];
    const files: ReportFile[] = [];
    for (const { file, limit } of candidates) {
      if (!file) continue;
      const content = readUtf8Tail(file, limit);
      if (!content) continue;
      files.push({ name: path.basename(file), content: redact(content) });
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

function newestFile(dir: string, accepts: (name: string) => boolean): string | null {
  let newest: { file: string; mtime: number } | null = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!accepts(name)) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (!newest || stat.mtimeMs > newest.mtime) newest = { file, mtime: stat.mtimeMs };
    }
  } catch {
    return null;
  }
  return newest?.file ?? null;
}

const TRUNCATED_MARKER = '[début tronqué]\n';
const TRUNCATED_MARKER_BYTES = Buffer.byteLength(TRUNCATED_MARKER);

export function readUtf8Tail(file: string, limitBytes: number): string {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = size <= limitBytes ? size : Math.max(0, limitBytes - TRUNCATED_MARKER_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      if (length === size) return buffer.toString('utf8');
      const firstLineEnd = buffer.indexOf(0x0a);
      const completeLines = firstLineEnd < 0 ? '' : buffer.subarray(firstLineEnd + 1).toString('utf8');
      return TRUNCATED_MARKER + completeLines;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
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
