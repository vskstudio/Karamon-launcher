import type { ReportSendResult } from '../../../ipc/contract';

export const CONSENT_TEXT = {
  title: 'Rapport de problème',
  question: "Un problème a été détecté. Envoyer le rapport à l'équipe Karamon pour qu'on t'aide ?",
  detail: 'Il contient les logs du launcher et du jeu, sans ton nom de session ni tes mots de passe.',
  send: 'Envoyer',
  later: 'Pas maintenant',
  always: 'Toujours envoyer automatiquement',
} as const;

export interface ReportMessage {
  text: string;
  tone: 'ok' | 'info';
}

/** What the player sees after a report; null when nothing should be shown (failures stay silent). */
export function reportResultMessage(result: ReportSendResult): ReportMessage | null {
  if (!result.code) return null;
  if (result.status === 'sent') return { text: `Rapport envoyé à l'équipe Karamon. Code : ${result.code}`, tone: 'ok' };
  if (result.status === 'queued') {
    return { text: `Rapport prêt, il partira au prochain lancement du launcher. Code : ${result.code}`, tone: 'info' };
  }
  return null;
}
