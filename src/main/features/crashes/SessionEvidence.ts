import fs from 'fs';
import path from 'path';
import { crashReportsDir, isCrashReportName, summarizeCrash } from './CrashReports.ts';

const FILE_CLOCK_SLACK_MS = 5000;
const HS_ERR_LOG = /^hs_err_pid\d+\.log$/;
const TRUNCATED_MARKER = '[début tronqué]\n';
const TRUNCATED_MARKER_BYTES = Buffer.byteLength(TRUNCATED_MARKER);

export class SessionEvidence {
  private readonly gameDir: string;
  private readonly writtenSince: number;

  constructor(gameDir: string, sessionStartedAt: number) {
    this.gameDir = gameDir;
    this.writtenSince = sessionStartedAt - FILE_CLOCK_SLACK_MS;
  }

  crashReports(): string[] {
    return this.filesOfSession(crashReportsDir(this.gameDir), isCrashReportName);
  }

  newestCrashReport(): string | null {
    return this.crashReports()[0] ?? null;
  }

  hsErrLogs(): string[] {
    return this.filesOfSession(this.gameDir, (name) => HS_ERR_LOG.test(name));
  }

  latestLog(): string | null {
    const log = path.join(this.gameDir, 'logs', 'latest.log');
    try {
      return fs.statSync(log).mtimeMs >= this.writtenSince ? log : null;
    } catch {
      return null;
    }
  }

  newestCrashReportText(): string | null {
    const report = this.newestCrashReport();
    if (!report) return null;
    try {
      return fs.readFileSync(report, 'utf8');
    } catch {
      return null;
    }
  }

  crashSummary(): string[] {
    const text = this.newestCrashReportText();
    return text === null ? [] : [summarizeCrash(text)];
  }

  private filesOfSession(dir: string, accepts: (name: string) => boolean): string[] {
    const found: Array<{ file: string; mtime: number }> = [];
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    for (const name of names) {
      if (!accepts(name)) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.mtimeMs >= this.writtenSince) found.push({ file, mtime: stat.mtimeMs });
      } catch {
        continue;
      }
    }
    return found.sort((a, b) => b.mtime - a.mtime).map(({ file }) => file);
  }
}

export function readFileTail(file: string, limitBytes: number): string {
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

export function trimToTail(text: string, limitBytes: number): string {
  if (Buffer.byteLength(text) <= limitBytes) return text;
  const body = Buffer.from(text.startsWith(TRUNCATED_MARKER) ? text.slice(TRUNCATED_MARKER.length) : text);
  const window = body.subarray(body.length - Math.max(0, limitBytes - TRUNCATED_MARKER_BYTES));
  const firstLineEnd = window.indexOf(0x0a);
  return TRUNCATED_MARKER + (firstLineEnd < 0 ? '' : window.subarray(firstLineEnd + 1).toString('utf8'));
}
