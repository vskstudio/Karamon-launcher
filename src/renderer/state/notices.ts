import { signal } from '@preact/signals';
import type { RepairOffer, ReportConsentRequest, UpdateInfo } from '../../ipc/contract';
import { toast } from '../ui';
import { api } from './api';
import { log } from './console';
import { config, saveConfig, system } from './config';

export interface PotatoSuggestion {
  reasons: string[];
}

export const pendingUpdate = signal<UpdateInfo | null>(null);
export const repairOffer = signal<RepairOffer | null>(null);
export const potatoSuggestion = signal<PotatoSuggestion | null>(null);
export const consentRequests = signal<ReportConsentRequest[]>([]);

export function dismissUpdate(): void {
  pendingUpdate.value = null;
}

export function dismissRepairOffer(): void {
  repairOffer.value = null;
}

export async function answerPotatoSuggestion(enable: boolean): Promise<void> {
  potatoSuggestion.value = null;
  await saveConfig(enable ? { potatoMode: true, potatoHintDismissed: true } : { potatoHintDismissed: true });
  if (enable) {
    toast('Mode PC modeste activé. Tu peux le couper dans les réglages.');
    log('Mode PC modeste activé.', 'success');
  }
}

export function suggestPotatoModeIfModest(): void {
  const current = config.value;
  const info = system.value;
  if (!current || !info) return;
  if (current.potatoMode || current.potatoHintDismissed || info.lowEndReasons.length === 0) return;
  potatoSuggestion.value = { reasons: info.lowEndReasons };
}

export function takeConsentRequest(reportId: string): void {
  consentRequests.value = consentRequests.value.filter((request) => request.reportId !== reportId);
}

export function wireNoticeEvents(): void {
  api.onUpdateReady((info) => {
    pendingUpdate.value = info;
    log(
      info.install === 'download'
        ? `Version ${info.version} disponible, à installer depuis le .dmg.`
        : `Mise à jour ${info.version} téléchargée.`,
      'success',
    );
  });
  api.onRepairOffer((offer) => {
    repairOffer.value = offer;
    if (offer.result.ok) log(`Réparation automatique terminée : ${offer.result.summary}`, 'success');
    else log(`Réparation automatique échouée : ${offer.result.error}`, 'error');
  });
  api.onReportConsent((request) => {
    consentRequests.value = [...consentRequests.value.filter((item) => item.reportId !== request.reportId), request];
  });
}
