import fs from 'fs';
import path from 'path';
import { ZipReader } from '../../shared/ZipReader.ts';
import { normalizeEntryPath, resolveInside } from '../../shared/ZipExtract.ts';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';

export const OVERRIDES_FORCE_PREFIXES = [
  'config/fancymenu/customization/',
  'config/fancymenu/assets/',
  'config/fancymenu/slideshows/',
  'config/fancymenu/ui_themes/',
  'config/fancymenu/customizablemenus.txt',
  'config/fancymenu/custom_gui_screens.txt',
  'config/fancymenu/options.txt',
];

const OVERRIDES_SKIP_PREFIXES = ['mods/', 'resourcepacks/', 'shaderpacks/', 'config/fancymenu/user_variables.db'];

export interface OverridesResult {
  written: number;
  kept: number;
}


function isForcedOverride(rel: string, forcePrefixes = OVERRIDES_FORCE_PREFIXES): boolean {
  return forcePrefixes.some((prefix) => rel.startsWith(prefix));
}

export function installOverrides(
  zipPath: string,
  gameDir: string,
  forcePrefixes = OVERRIDES_FORCE_PREFIXES,
): OverridesResult {
  const root = path.resolve(gameDir);
  let written = 0;
  let kept = 0;
  ZipReader.with(zipPath, (zip) => {
    for (const entry of zip.entries) {
      if (entry.isDirectory) continue;
      const rel = normalizeEntryPath(entry.entryName);
      if (!rel || OVERRIDES_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
      const target = resolveInside(root, rel, entry.entryName);
      const force = isForcedOverride(rel, forcePrefixes);
      if (!force && fs.existsSync(target)) {
        kept++;
        continue;
      }
      const data = zip.read(entry);
      if (force && sameContent(target, data)) {
        kept++;
        continue;
      }
      writeFileAtomic(target, data);
      written++;
    }
  });
  return { written, kept };
}

function sameContent(file: string, data: Buffer): boolean {
  try {
    return fs.readFileSync(file).equals(data);
  } catch {
    return false;
  }
}
