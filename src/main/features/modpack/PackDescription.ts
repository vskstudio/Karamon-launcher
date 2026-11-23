import crypto from 'crypto';
import type { GameInstance } from '../../shared/GameInstance.ts';
import { parseClientOptionsText, type ClientOptions } from '../../shared/ClientOptions.ts';

export const MODS_ZIP = 'mods.zip';
export const ASSETS_ZIP = 'assets.zip';
const MODS_MANIFEST = 'mods-manifest.json';
const OVERRIDES_MANIFEST = 'overrides-manifest.json';
const CLIENT_OPTIONS = 'client-options.json';
const SHA1_HEX = /^[0-9a-f]{40}$/i;

export interface ManifestEntry {
  name: string;
  size: number;
  sha1?: string;
  extract?: boolean;
}

export interface GroupManifest {
  present: boolean;
  key: string;
  entries: ManifestEntry[];
}

export interface OverridesManifest {
  present: boolean;
  key: string;
  name: string;
  size: number;
  sha1?: string;
}

export type AssetGroupId = 'resourcepacks' | 'shaderpacks';

export interface AssetGroup {
  id: AssetGroupId;
  manifest: string;
  pathPrefix: string;
  countLabel: string;
  removedLabel: string;
  dirIn(instance: GameInstance): string;
  isPlayerSettings(name: string): boolean;
}

export const ASSET_GROUPS: AssetGroup[] = [
  {
    id: 'resourcepacks',
    manifest: 'resourcepacks-manifest.json',
    pathPrefix: 'resourcepacks/',
    countLabel: 'resource packs',
    removedLabel: 'Resource pack supprimé',
    dirIn: (instance) => instance.resourcePacksDir,
    isPlayerSettings: () => false,
  },
  {
    id: 'shaderpacks',
    manifest: 'shaderpacks-manifest.json',
    pathPrefix: 'shaderpacks/',
    countLabel: 'shaders',
    removedLabel: 'Shader pack supprimé',
    dirIn: (instance) => instance.shaderPacksDir,
    isPlayerSettings: (name) => name.toLowerCase().endsWith('.txt'),
  },
];

export interface PackDescription {
  mods: ManifestEntry[] | undefined;
  groups: Record<AssetGroupId, GroupManifest>;
  overrides: OverridesManifest;
  clientOptions: ClientOptions | null;
}

export type ReadPackText = (name: string) => Promise<string | null>;

export async function readPackDescription(read: ReadPackText): Promise<PackDescription> {
  const [mods, resourcepacks, shaderpacks, overrides, clientOptions] = await Promise.all([
    read(MODS_MANIFEST),
    read(ASSET_GROUPS[0].manifest),
    read(ASSET_GROUPS[1].manifest),
    read(OVERRIDES_MANIFEST),
    read(CLIENT_OPTIONS),
  ]);
  return {
    mods: mods === null ? undefined : parseManifest(mods, MODS_MANIFEST),
    groups: {
      resourcepacks: groupManifest(resourcepacks, ASSET_GROUPS[0].manifest),
      shaderpacks: groupManifest(shaderpacks, ASSET_GROUPS[1].manifest),
    },
    overrides: overrides === null ? absentOverrides() : parseOverridesManifest(overrides),
    clientOptions: clientOptions === null ? null : parseClientOptionsText(clientOptions),
  };
}

export function groupManifest(text: string | null, label: string): GroupManifest {
  if (text === null) return absentGroup();
  const entries = parseManifest(text, label);
  return { present: true, key: entriesKey(entries), entries };
}

export function absentGroup(): GroupManifest {
  return { present: false, key: '', entries: [] };
}

export function entriesKey(entries: ManifestEntry[]): string {
  return hashText(JSON.stringify(entries));
}

export function absentOverrides(): OverridesManifest {
  return { present: false, key: '', name: '', size: 0 };
}

export function folderNameFor(zipName: string): string {
  return zipName.replace(/\.zip$/i, '');
}

export function extractedFolders(entries: ManifestEntry[]): string[] {
  return entries.filter((e) => e.extract).map((e) => folderNameFor(e.name));
}

export function hashText(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

export function parseSha1(value: unknown): string | undefined {
  return typeof value === 'string' && SHA1_HEX.test(value) ? value.toLowerCase() : undefined;
}

function parseManifest(text: string, label: string): ManifestEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Manifest ${label} illisible: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new Error(`Manifest ${label} invalide (attendu: tableau)`);
  return raw.flatMap((item): ManifestEntry[] => {
    if (!item || typeof item !== 'object') return [];
    const e = item as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.size !== 'number') return [];
    const entry: ManifestEntry = { name: e.name, size: e.size };
    const sha1 = parseSha1(e.sha1);
    if (sha1) entry.sha1 = sha1;
    if (e.extract === true) entry.extract = true;
    return [entry];
  });
}

function parseOverridesManifest(text: string): OverridesManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Manifest ${OVERRIDES_MANIFEST} illisible: ${(e as Error).message}`);
  }
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof value.name !== 'string' || typeof value.size !== 'number' || value.size <= 0) {
    return absentOverrides();
  }
  const manifest: OverridesManifest = { present: true, key: hashText(text), name: value.name, size: value.size };
  const sha1 = parseSha1(value.sha1);
  if (sha1) manifest.sha1 = sha1;
  return manifest;
}
