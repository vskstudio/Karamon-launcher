import { computed, signal } from '@preact/signals';
import type { AppConfig, AppConfigUpdate } from '../../ipc/contract';
import { config, saveConfig } from './config';
import { DEFAULT_MEMORY_MB, DEFAULT_SECOND_MEMORY_MB } from './memory';
import { potatoSuggestion } from './notices';
import { hideWhileSaving } from './hideWhileSaving';

export type SettingsDraft = Omit<AppConfig, 'server' | 'potatoHintDismissed'>;
export type SettingKey = keyof SettingsDraft;
export type BooleanSettingKey = { [K in SettingKey]: SettingsDraft[K] extends boolean ? K : never }[SettingKey];

export const settingsEdits = signal<Partial<SettingsDraft>>({});

export const savedSettings = computed<SettingsDraft | null>(() => {
  const current = config.value;
  if (!current) return null;
  const draft: Partial<AppConfig> = { ...current };
  delete draft.server;
  delete draft.potatoHintDismissed;
  return {
    ...(draft as SettingsDraft),
    memoryMb: current.memoryMb || DEFAULT_MEMORY_MB,
    secondInstanceMemoryMb: current.secondInstanceMemoryMb || DEFAULT_SECOND_MEMORY_MB,
  };
});

export const draftSettings = computed<SettingsDraft | null>(() => {
  const saved = savedSettings.value;
  return saved ? { ...saved, ...settingsEdits.value } : null;
});

function normalized(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const dirtySettingKeys = computed<SettingKey[]>(() => {
  const saved = savedSettings.value;
  if (!saved) return [];
  const edits = settingsEdits.value;
  return (Object.keys(edits) as SettingKey[]).filter((key) => normalized(edits[key]) !== normalized(saved[key]));
});

export function editSetting<K extends SettingKey>(key: K, value: SettingsDraft[K]): void {
  settingsEdits.value = { ...settingsEdits.value, [key]: value };
}

export function discardSettings(): void {
  settingsEdits.value = {};
}

export async function saveSettings(): Promise<void> {
  const edits = settingsEdits.value;
  const update: AppConfigUpdate = {};
  for (const key of dirtySettingKeys.value) {
    Object.assign(update, { [key]: normalized(edits[key]) });
  }
  const answersSuggestion = update.potatoMode !== undefined && !config.value?.potatoHintDismissed;
  if (answersSuggestion) update.potatoHintDismissed = true;
  const outcome = await hideWhileSaving(potatoSuggestion, answersSuggestion ? null : potatoSuggestion.value, () => saveConfig(update));
  if (!outcome.ok) throw new Error(outcome.error);
  settingsEdits.value = {};
}
