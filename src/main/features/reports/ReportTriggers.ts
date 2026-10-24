import { EARLY_CRASH_WINDOW_MS } from '../integrity/CrashDiagnosis.ts';
import type { ReportTrigger } from './ReportTypes.ts';

export type LaunchPhase = 'sync' | 'launch';
export type AutomaticTrigger = Exclude<ReportTrigger, 'manual'>;

/** Erreur du bouton Jouer qui dit quelle phase a échoué, sans dépendre du texte affiché. */
export class LaunchPhaseError extends Error {
  readonly phase: LaunchPhase;

  constructor(phase: LaunchPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LaunchPhaseError';
    this.phase = phase;
  }
}

/** Trigger d'une sortie de Minecraft ; null pour une fermeture normale, même terminée par un crash natif. */
export function exitTrigger(
  code: number | null,
  startedAt: number,
  endedAt: number,
  stoppedCleanly = false,
): 'crash_early' | 'crash' | null {
  if (code === 0 || stoppedCleanly) return null;
  return endedAt - startedAt <= EARLY_CRASH_WINDOW_MS ? 'crash_early' : 'crash';
}

export function failureTrigger(error: unknown): 'sync_failed' | 'launch_failed' {
  return error instanceof LaunchPhaseError && error.phase === 'sync' ? 'sync_failed' : 'launch_failed';
}

export function failureSummary(error: unknown): string[] {
  const phase = failureTrigger(error) === 'sync_failed' ? 'Synchronisation du pack' : 'Lancement du jeu';
  const message = error instanceof Error ? error.message : String(error);
  return [phase, message];
}
