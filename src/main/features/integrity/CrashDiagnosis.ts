import { SessionEvidence, readFileTail } from '../crashes/SessionEvidence.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

const EARLY_CRASH_WINDOW_MS = 2 * 60 * 1000;
const LOG_TAIL_BYTES = 256 * 1024;
const NORMAL_SHUTDOWN_LINE = /\[Render thread\/INFO\]: Stopping!/;

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

export function detectCorruption(text: string): string[] {
  const reasons = SIGNATURES.filter(({ regex }) => regex.test(text)).map(({ reason }) => reason);
  if (nulNearJsonError(text)) reasons.push(NUL_REASON);
  return reasons;
}

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

export function readCrashEvidence(instance: GameInstance, sinceMs: number): string {
  const evidence = new SessionEvidence(instance, sinceMs);
  const log = evidence.latestLog();
  return [evidence.newestCrashReportText(), log && readFileTail(log, LOG_TAIL_BYTES)]
    .filter((part): part is string => !!part)
    .join('\n');
}

export function stoppedCleanly(instance: GameInstance, sinceMs: number): boolean {
  const evidence = new SessionEvidence(instance, sinceMs);
  if (evidence.newestCrashReport()) return false;
  const log = evidence.latestLog();
  return !!log && NORMAL_SHUTDOWN_LINE.test(readFileTail(log, LOG_TAIL_BYTES));
}
