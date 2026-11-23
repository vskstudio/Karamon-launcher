import fs from 'fs';
import path from 'path';
import { ZipReader } from './ZipReader.ts';

export interface ZipExtractOptions {
  stripCommonTopLevelFolder?: boolean;
  exclude?: string[];
  durable?: boolean;
}

export async function extractZipToDir(
  zipPath: string,
  destDir: string,
  { stripCommonTopLevelFolder = false, exclude = [], durable = false }: ZipExtractOptions = {},
): Promise<void> {
  await ZipReader.withAsync(zipPath, async (zip) => {
    const entries = zip.entries;
    const stripPrefix = stripCommonTopLevelFolder ? commonTopLevelPrefix(entries) : '';
    fs.mkdirSync(destDir, { recursive: true });
    const root = path.resolve(destDir);

    for (const entry of entries) {
      const entryName = entry.entryName;
      if (exclude.some((prefix) => entryName.startsWith(prefix))) continue;
      const relName = stripPrefix ? entryName.slice(stripPrefix.length) : entryName;
      if (!relName) continue;

      const target = resolveInside(root, relName, entryName);
      if (entry.isDirectory) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      await zip.extractTo(entry, target, { durable });
    }
  });
}

export function resolveInside(rootDir: string, relPath: string, label = relPath): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Chemin refusé (path traversal): ${label}`);
  }
  return target;
}

export function commonTopLevelPrefix(entries: { entryName: string }[]): string {
  let prefix: string | null = null;
  for (const entry of entries) {
    const name = entry.entryName;
    const slash = name.indexOf('/');
    if (slash === -1) return '';
    const top = name.slice(0, slash + 1);
    if (prefix === null) prefix = top;
    else if (prefix !== top) return '';
  }
  return prefix ?? '';
}

export function normalizeEntryPath(entryName: string): string {
  return entryName.replace(/\\/g, '/').replace(/^\.?\/+/, '');
}
