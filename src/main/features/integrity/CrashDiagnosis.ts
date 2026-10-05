import fs from 'fs';
import path from 'path';

/** A startup crash: the game died within this window after being spawned. */
export const EARLY_CRASH_WINDOW_MS = 2 * 60 * 1000;
const LOG_TAIL_BYTES = 256 * 1024;
const CLOCK_SLACK_MS = 5000;

const SIGNATURES: Array<{ regex: RegExp; reason: string }> = [
  { regex: /zip END header not found/i, reason: 'archive tronquée (zip END header not found)' },
  { regex: /ZipException/, reason: 'archive illisible (ZipException)' },
  { regex: /Error analyzing \[/, reason: 'mod illisible (Error analyzing)' },
];
const NUL_MARKER = /\\u0000|\u0000/;
const JSON_ERROR = /Not a JSON Object|json|gson|BEGIN_OBJECT|BEGIN_ARRAY|Malformed/i;
const NUL_CONTEXT_LINES = 3;
const NUL_REASON = 'fichier de config rempli d’octets nuls (\\u0000)';

export function isEarlyCrash(code: number | null, startedAt: number, endedAt: number): boolean {
  return code !== 0 && endedAt - startedAt <= EARLY_CRASH_WINDOW_MS;
}

/** Reasons the crash text points at damaged files; empty when it doesn't. */
export function detectCorruption(text: string): string[] {
  const reasons = SIGNATURES.filter(({ regex }) => regex.test(text)).map(({ reason }) => reason);
  if (nulNearJsonError(text)) reasons.push(NUL_REASON);
  return reasons;
}

/** A NUL (raw or escaped) on a line at most a few lines after a JSON parse error. */
function nulNearJsonError(text: string): boolean {
  if (!NUL_MARKER.test(text)) return false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!NUL_MARKER.test(lines[i])) continue;
    const context = lines.slice(Math.max(0, i - NUL_CONTEXT_LINES), i + 1).join('\n');
    if (JSON_ERROR.test(context)) return true;
  }
  return false;
}

/** The crash report written by this run (if any) plus the tail of latest.log. */
export function readCrashEvidence(gameDir: string, sinceMs: number): string {
  const parts: string[] = [];
  const report = newestCrashReport(path.join(gameDir, 'crash-reports'), sinceMs - CLOCK_SLACK_MS);
  if (report) parts.push(readText(report));
  const log = path.join(gameDir, 'logs', 'latest.log');
  try {
    if (fs.statSync(log).mtimeMs >= sinceMs - CLOCK_SLACK_MS) parts.push(readTail(log, LOG_TAIL_BYTES));
  } catch {
    /* no log */
  }
  return parts.join('\n');
}

function newestCrashReport(dir: string, sinceMs: number): string | null {
  let best: { file: string; mtime: number } | null = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.txt')) continue;
      const file = path.join(dir, name);
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime >= sinceMs && (!best || mtime > best.mtime)) best = { file, mtime };
    }
  } catch {
    return null;
  }
  return best?.file ?? null;
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readTail(file: string, bytes: number): string {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}
