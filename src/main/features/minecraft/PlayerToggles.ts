import type { GameInstance } from '../../shared/GameInstance.ts';
import { ModToggles, type ReasonChanges } from '../modtoggles/ModToggles.ts';
import { PotatoMode, potatoSummary } from '../potato/PotatoMode.ts';
import { POTATO_REASON } from '../potato/PotatoMods.ts';
import { SODIUM_REASON, sodiumSummary } from '../sodium/SodiumOff.ts';

export interface ToggleSettings {
  potatoMode: boolean;
  disableSodium: boolean;
}

export type ToggleTrigger = 'sync' | 'potato' | 'sodium';

export function reconcilePlayerToggles(
  instance: GameInstance,
  settings: ToggleSettings,
  packJars: Set<string> | null,
  trigger: ToggleTrigger,
  onStatus: (message: string) => void,
): void {
  const potatoReason = { reason: POTATO_REASON, active: settings.potatoMode };
  const sodiumReason = { reason: SODIUM_REASON, active: settings.disableSodium };
  const changes = new ModToggles(instance).reconcile(
    trigger === 'sodium' ? [sodiumReason, potatoReason] : [potatoReason, sodiumReason],
    packJars,
  );
  const none: ReasonChanges = { parked: [], unparked: [], errors: [] };
  const potatoJars = changes.get(POTATO_REASON.key) ?? none;
  const sodiumJars = changes.get(SODIUM_REASON.key) ?? none;

  const potatoSettings = settings.potatoMode ? PotatoMode.applySettings(instance) : PotatoMode.restoreSettings(instance);
  const potato = {
    settings: potatoSettings.settings,
    mods: settings.potatoMode ? potatoJars.parked : potatoJars.unparked,
    errors: [...potatoSettings.errors, ...potatoJars.errors],
  };
  const potatoChanged = potato.settings.length > 0 || potato.mods.length > 0;
  if (trigger === 'potato' || (trigger === 'sync' && settings.potatoMode) || potatoChanged) onStatus(potatoSummary(settings.potatoMode, potato));
  for (const error of potato.errors) onStatus(`Mode PC modeste, fichier ignoré : ${error}`);

  const sodiumMods = settings.disableSodium ? sodiumJars.parked : sodiumJars.unparked;
  if (trigger === 'sodium' || sodiumMods.length > 0) onStatus(sodiumSummary(settings.disableSodium, sodiumMods));
  for (const error of sodiumJars.errors) onStatus(`Désactiver Sodium, fichier ignoré : ${error}`);
}
