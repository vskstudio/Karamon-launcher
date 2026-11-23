import { toggledModFor, type ToggleReason, type ToggledMod } from '../modtoggles/ModToggles.ts';

export const POTATO_MODS: ToggledMod[] = [
  { id: 'voxy', label: 'Voxy (vue lointaine)', file: /^voxy-\d/i },
  { id: 'particular', label: 'Particular (particules d’ambiance)', file: /^particular-/i },
  { id: 'particlerain', label: 'Particle Rain (particules météo)', file: /^particlerain-/i },
  { id: 'sound_physics_remastered', label: 'Sound Physics Remastered (sons réalistes)', file: /^sound-physics-remastered-/i },
];

export const POTATO_REASON: ToggleReason = { key: 'potato', mods: POTATO_MODS };

export function potatoModFor(fileName: string): ToggledMod | null {
  return toggledModFor(POTATO_MODS, fileName);
}
