import fs from 'fs';
import path from 'path';

export interface PackProfile {
  minecraft: string;
  fabricVersion: string;
  cdnBaseUrl: string;
  profileName: string;
  publicServerHost: string;
  statusFallbackHost: string;
  clientDisabledJarPrefixes: string[];
}

const DEFAULTS: PackProfile = {
  minecraft: '1.21.1',
  fabricVersion: '0.18.4',
  cdnBaseUrl: 'https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/',
  profileName: 'Karamon',
  publicServerHost: 'karamon.fr',
  statusFallbackHost: 'play.karamon.fr',
  clientDisabledJarPrefixes: ['c2me-fabric'],
};

interface PackJson {
  minecraft?: string;
  loaderVersion?: string;
  cdnBaseUrl?: string;
  clientDisabledJarPrefixes?: unknown;
}

export function loadPackProfile(distDir: string): PackProfile {
  const candidates = [
    path.join(distDir, 'pack.json'),
    path.join(distDir, '..', 'content', 'pack.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PackJson;
      return {
        ...DEFAULTS,
        minecraft: typeof raw.minecraft === 'string' && raw.minecraft ? raw.minecraft : DEFAULTS.minecraft,
        fabricVersion:
          typeof raw.loaderVersion === 'string' && raw.loaderVersion
            ? raw.loaderVersion
            : DEFAULTS.fabricVersion,
        cdnBaseUrl:
          typeof raw.cdnBaseUrl === 'string' && raw.cdnBaseUrl ? raw.cdnBaseUrl : DEFAULTS.cdnBaseUrl,
        clientDisabledJarPrefixes: parsePrefixes(raw.clientDisabledJarPrefixes),
      };
    } catch {
      /* try next candidate */
    }
  }
  return { ...DEFAULTS };
}

function parsePrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULTS.clientDisabledJarPrefixes;
  const prefixes = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return prefixes.length > 0 ? prefixes : DEFAULTS.clientDisabledJarPrefixes;
}
