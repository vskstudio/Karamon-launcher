import type { ReportSendResult } from '../../../ipc/contract';

export const CONSENT_TEXT = {
  title: 'Rapport de problème',
  question: "Un problème a été détecté. Envoyer le rapport à l'équipe Karamon pour qu'on t'aide ?",
  detail:
    'Il contient les journaux du launcher et du jeu. Avant l’envoi, on masque ton nom de session, ' +
    'le nom de ton PC, tes jetons de connexion, tes adresses IP et e-mail. ' +
    'Ton pseudo Minecraft peut apparaître dans les journaux du jeu.',
  declineHint: 'Ne pas envoyer supprime le rapport de ton PC.',
  send: 'Envoyer',
  decline: 'Ne pas envoyer',
  always: 'Toujours envoyer automatiquement',
} as const;

export interface ReportMessage {
  text: string;
  tone: 'ok' | 'info';
}

/** What the player sees after a report; null when nothing should be shown (failures stay silent). */
export function reportResultMessage(result: ReportSendResult): ReportMessage | null {
  switch (result.status) {
    case 'sent':
      return {
        text: result.supportCode
          ? `Rapport envoyé à l'équipe Karamon. Code support : ${result.supportCode}`
          : "Rapport envoyé à l'équipe Karamon.",
        tone: 'ok',
      };
    case 'queued':
      // No code before the panel accepted the report.
      return { text: 'Rapport en attente.', tone: 'info' };
    case 'skipped':
      return result.reason === 'manual_limit'
        ? { text: 'Tu as déjà envoyé plusieurs rapports. Réessaie dans quelques minutes.', tone: 'info' }
        : null;
    case 'failed':
      return null;
  }
}
