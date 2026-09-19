import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
// Explicit extension so node --experimental-strip-types can run the unit test; esbuild bundles it fine.
import { resolveInside } from '../../shared/ZipExtract.ts';

/**
 * Files under these prefixes are owned by the pack: every sync rewrites them so
 * menu/branding updates reach players. Everything else in overrides.zip is a
 * first-install default and is only written when the player has no file yet.
 */
export const OVERRIDES_FORCE_PREFIXES = [
  'config/fancymenu/customization/',
  'config/fancymenu/assets/',
  'config/fancymenu/slideshows/',
  'config/fancymenu/ui_themes/',
  'config/fancymenu/customizablemenus.txt',
  'config/fancymenu/custom_gui_screens.txt',
  'config/fancymenu/options.txt',
];

/** Never extracted: runtime state, or folders synced by their own pipeline. */
const OVERRIDES_SKIP_PREFIXES = ['mods/', 'resourcepacks/', 'shaderpacks/', 'config/fancymenu/user_variables.db'];

export interface OverridesResult {
  written: number;
  kept: number;
}

export function normalizeOverridePath(entryName: string): string {
  return entryName.replace(/\\/g, '/').replace(/^\.?\/+/, '');
}

export function isForcedOverride(rel: string, forcePrefixes = OVERRIDES_FORCE_PREFIXES): boolean {
  return forcePrefixes.some((prefix) => rel.startsWith(prefix));
}

export function installOverrides(
  zipPath: string,
  gameDir: string,
  forcePrefixes = OVERRIDES_FORCE_PREFIXES,
): OverridesResult {
  const zip = new AdmZip(zipPath);
  const root = path.resolve(gameDir);
  let written = 0;
  let kept = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const rel = normalizeOverridePath(entry.entryName);
    if (!rel || OVERRIDES_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const target = resolveInside(root, rel, entry.entryName);
    const force = isForcedOverride(rel, forcePrefixes);
    if (!force && fs.existsSync(target)) {
      kept++;
      continue;
    }
    const data = entry.getData();
    if (force && fs.existsSync(target)) {
      try {
        if (fs.readFileSync(target).equals(data)) {
          kept++;
          continue;
        }
      } catch {
        /* rewrite below */
      }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return { written, kept };
}
