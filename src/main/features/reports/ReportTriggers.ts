import { isEarlyCrash } from '../integrity/CrashDiagnosis.ts';
import type { ReportTrigger } from './ReportTypes.ts';

export type LaunchPhase = 'sync' | 'launch';
export type AutomaticTrigger = Exclude<ReportTrigger, 'manual'>;

export class LaunchPhaseError extends Error {
  readonly phase: LaunchPhase;

  constructor(phase: LaunchPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LaunchPhaseError';
    this.phase = phase;
  }
}

export function exitTrigger(
  code: number | null,
  startedAt: number,
  endedAt: number,
  stoppedCleanly = false,
): 'crash_early' | 'crash' | null {
  if (code === 0 || stoppedCleanly) return null;
  return isEarlyCrash(code, startedAt, endedAt) ? 'crash_early' : 'crash';
}

export function failureTrigger(error: unknown): 'sync_failed' | 'launch_failed' {
  return error instanceof LaunchPhaseError && error.phase === 'sync' ? 'sync_failed' : 'launch_failed';
}

export function failureSummary(error: unknown): string[] {
  const phase = failureTrigger(error) === 'sync_failed' ? 'Synchronisation du pack' : 'Lancement du jeu';
  const message = error instanceof Error ? error.message : String(error);
  return [phase, message];
}
