import type { AppConfig, SystemInfo } from '../../ipc/contract';
import { KARAMON } from '../../shared/Karamon';

export const DEFAULT_MEMORY_MB = KARAMON.defaultMemoryMb;
export const DEFAULT_SECOND_MEMORY_MB = 6144;
export const MIN_MEMORY_MB = 2048;
export const MEMORY_STEP_MB = 512;
export const MIN_COMFORTABLE_MEMORY_MB = 8192;
export const RECOMMENDED_MAX_MB = KARAMON.defaultMemoryMb;
export const PACK_MIN_MEMORY_MB = 4096;

export type MemoryTone = 'success' | 'warning' | 'danger';

export interface MemoryVerdict {
  label: string;
  tone: MemoryTone;
  hint: string;
}

export function formatGo(mb: number, maximumFractionDigits = 1): string {
  return `${(mb / 1024).toLocaleString('fr-FR', { maximumFractionDigits })} Go`;
}

export function memoryMaxMb(totalMemMb: number | undefined): number {
  if (!totalMemMb) return RECOMMENDED_MAX_MB;
  return Math.max(RECOMMENDED_MAX_MB, Math.floor(totalMemMb / MEMORY_STEP_MB) * MEMORY_STEP_MB);
}

export function startupMemoryMb(config: AppConfig, system: SystemInfo | null): number {
  const chosen = config.memoryMb || DEFAULT_MEMORY_MB;
  const cap = system?.potatoMemoryCapMb ?? null;
  return config.potatoMode && cap !== null ? Math.min(chosen, cap) : chosen;
}

export function memoryVerdict(memoryMb: number, system: SystemInfo | null, potatoMode: boolean): MemoryVerdict {
  const total = system?.totalMemMb ?? 0;
  const cap = system?.potatoMemoryCapMb ?? null;
  if (potatoMode && cap !== null && cap < memoryMb) {
    return {
      label: 'Mode PC modeste',
      tone: 'warning',
      hint: `Mode PC modeste actif : le jeu démarre avec ${formatGo(cap)} tant qu’il reste allumé.`,
    };
  }
  if (total && memoryMb > total) {
    return { label: 'Trop élevé', tone: 'danger', hint: 'Plus que la RAM de ton PC, Minecraft ne pourra pas démarrer.' };
  }
  if (total && memoryMb / total > 0.75) {
    return {
      label: 'Élevé',
      tone: 'warning',
      hint: `${Math.round((memoryMb / total) * 100)} % de ta RAM, le reste du PC risque de ramer.`,
    };
  }
  if (memoryMb < MIN_COMFORTABLE_MEMORY_MB) {
    return { label: 'Trop peu', tone: 'warning', hint: `Sous ${formatGo(MIN_COMFORTABLE_MEMORY_MB)}, le pack risque de manquer de mémoire.` };
  }
  if (memoryMb > RECOMMENDED_MAX_MB) return { label: 'Généreux', tone: 'success', hint: '' };
  return { label: 'Recommandé', tone: 'success', hint: '' };
}

export function potatoMemoryNote(system: SystemInfo): string {
  const cap = system.potatoMemoryCapMb;
  const total = formatGo(system.totalMemMb, 0);
  if (cap === null) return 'Mémoire : ton réglage est gardé.';
  if (cap < PACK_MIN_MEMORY_MB) {
    return `Mémoire limitée à ${formatGo(cap)} (ton PC a ${total} de RAM) : c'est trop peu pour le pack, il risque de planter au chargement.`;
  }
  return `Mémoire limitée à ${formatGo(cap)} au plus (ton PC a ${total} de RAM), pour laisser de la place au système. Un réglage plus bas est gardé.`;
}
