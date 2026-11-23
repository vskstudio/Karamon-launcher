import { toggledModFor, type ToggleReason, type ToggledMod } from '../modtoggles/ModToggles.ts';

export const SODIUM_MODS: ToggledMod[] = [
  { id: 'sodium', label: 'Sodium', file: /^sodium-fabric-/i },
  { id: 'iris', label: 'Iris', file: /^iris-/i },
  { id: 'voxy', label: 'Voxy', file: /^voxy-\d/i },
  { id: 'sodium-extra', label: 'Sodium Extra', file: /^sodium-extra-/i },
  { id: 'reeses-sodium-options', label: "Reese's Sodium Options", file: /^reeses-sodium-options-/i },
];

export const SODIUM_REASON: ToggleReason = { key: 'sodium', mods: SODIUM_MODS };

export function sodiumSummary(disabled: boolean, mods: string[]): string {
  const names = mods.map((jar) => toggledModFor(SODIUM_MODS, jar)?.label ?? jar);
  const head = disabled ? 'Sodium désactivé' : 'Sodium réactivé';
  return names.length > 0 ? `${head} : ${names.join(', ')}.` : `${head}.`;
}
