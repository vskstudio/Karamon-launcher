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

/** How the game process ended. */
export interface GameExit {
  code: number | null;
  /** Signal that ended the process, when it was one. */
  signal?: NodeJS.Signals | null;
  /** The launcher itself asked the game to stop. */
  stopRequested?: boolean;
}

/** Signals someone sends to close a program on purpose (player, session logout, launcher). */
const REQUESTED_STOP_SIGNALS = new Set<string>(['SIGTERM', 'SIGINT', 'SIGHUP']);

/** Trigger d'une sortie de Minecraft ; null pour une fermeture normale ou demandée. */
export function exitTrigger(exit: GameExit, startedAt: number, endedAt: number): 'crash_early' | 'crash' | null {
  if (exit.code === 0 || exit.stopRequested) return null;
  if (exit.signal && REQUESTED_STOP_SIGNALS.has(exit.signal)) return null;
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
