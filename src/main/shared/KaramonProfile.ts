import fs from 'fs';
import path from 'path';
import { loadClientOptions, type ClientOptions } from './ClientOptions.ts';
import { KARAMON, type KaramonIdentity } from '../../shared/Karamon.ts';

const MINECRAFT_PROTOCOL_VERSIONS: Readonly<Record<string, number>> = {
  '1.21': 767,
  '1.21.1': 767,
};

const PACK_DEFAULTS = {
  version: 'inconnu',
  minecraft: '1.21.1',
  fabricVersion: '0.18.4',
  cdnBaseUrl: `${KARAMON.websiteUrl}/downloads/`,
  clientDisabledJarPrefixes: ['c2me-fabric'],
};

export interface KaramonProfile extends KaramonIdentity {
  version: string;
  minecraft: string;
  protocolVersion: number;
  fabricVersion: string;
  cdnBaseUrl: string;
  clientDisabledJarPrefixes: string[];
  clientOptions: ClientOptions | null;
}

interface PackJson {
  version?: unknown;
  minecraft?: unknown;
  loaderVersion?: unknown;
  cdnBaseUrl?: unknown;
  clientDisabledJarPrefixes?: unknown;
}

export function karamonProfile(packJson: PackJson | null, clientOptions: ClientOptions | null): KaramonProfile {
  const minecraft = nonEmptyString(packJson?.minecraft) ?? PACK_DEFAULTS.minecraft;
  return {
    ...KARAMON,
    version: nonEmptyString(packJson?.version) ?? PACK_DEFAULTS.version,
    minecraft,
    protocolVersion: MINECRAFT_PROTOCOL_VERSIONS[minecraft] ?? MINECRAFT_PROTOCOL_VERSIONS[PACK_DEFAULTS.minecraft],
    fabricVersion: nonEmptyString(packJson?.loaderVersion) ?? PACK_DEFAULTS.fabricVersion,
    cdnBaseUrl: nonEmptyString(packJson?.cdnBaseUrl) ?? PACK_DEFAULTS.cdnBaseUrl,
    clientDisabledJarPrefixes: jarPrefixes(packJson?.clientDisabledJarPrefixes),
    clientOptions,
  };
}

export const KARAMON_DEFAULT_PROFILE: KaramonProfile = karamonProfile(null, null);

export function loadKaramonProfile(distDir: string): KaramonProfile {
  const candidates = [path.join(distDir, 'pack.json'), path.join(distDir, '..', 'content', 'pack.json')];
  for (const file of candidates) {
    const packJson = readPackJson(file);
    if (packJson) return karamonProfile(packJson, loadClientOptions(path.dirname(file)));
  }
  return karamonProfile(null, loadClientOptions(distDir));
}

function readPackJson(file: string): PackJson | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as PackJson) : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function jarPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return PACK_DEFAULTS.clientDisabledJarPrefixes;
  const prefixes = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return prefixes.length > 0 ? prefixes : PACK_DEFAULTS.clientDisabledJarPrefixes;
}
