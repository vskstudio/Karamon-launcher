import { ZipReader } from '../../shared/ZipReader.ts';

/**
 * Pack mods the mode PC modeste switches off. Each one was checked against the
 * pack and the live server (October 2026):
 * - it only draws or plays things on the player's screen (no block, item or
 *   entity of its own, nothing another mod needs: no `depends` on it);
 * - the server does not run it, so it can't require it at login.
 *
 * A jar is switched off only when its file name matches AND its
 * fabric.mod.json id is the expected one: a renamed or unreadable jar stays on.
 */
export interface PotatoMod {
  id: string;
  label: string;
  file: RegExp;
}

export const POTATO_MODS: PotatoMod[] = [
  // LOD renderer: distant terrain on the GPU, background threads, a large disk and RAM cache.
  // Voxy Server Side (`lss`) stays: the server runs it, and it detects Voxy by reflection.
  { id: 'voxy', label: 'Voxy (vue lointaine)', file: /^voxy-\d/i },
  // Extra ambient particles (fireflies, falling leaves, waterfall spray).
  { id: 'particular', label: 'Particular (particules d’ambiance)', file: /^particular-/i },
  // Rain, snow and dust particles.
  { id: 'particlerain', label: 'Particle Rain (particules météo)', file: /^particlerain-/i },
  // Ray-traced reverb and occlusion of every sound, on the CPU.
  { id: 'sound_physics_remastered', label: 'Sound Physics Remastered (sons réalistes)', file: /^sound-physics-remastered-/i },
];

/** Never switched off, whatever the list above says. */
const PROTECTED = /^(karamon|cobblemon|lootbox|lss|fabric|sodium|iris|minecraft|java)/i;

/** The mode's entry for a jar file name, or null. */
export function potatoModFor(fileName: string): PotatoMod | null {
  if (!fileName.toLowerCase().endsWith('.jar')) return null;
  return POTATO_MODS.find((mod) => mod.file.test(fileName) && !PROTECTED.test(mod.id)) ?? null;
}

/** `id` from the jar's fabric.mod.json, or null when it can't be read. */
export function readModId(jarPath: string): string | null {
  try {
    return ZipReader.with(jarPath, (zip) => {
      const entry = zip.entries.find((e) => e.entryName === 'fabric.mod.json');
      if (!entry) return null;
      const json = JSON.parse(zip.read(entry).toString('utf8')) as { id?: unknown };
      return typeof json.id === 'string' ? json.id : null;
    });
  } catch {
    return null;
  }
}
