import fs from 'fs';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { parseClientOptions, type ClientOptions } from '../../shared/ClientOptions.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import {
  absentGroup,
  absentOverrides,
  entriesKey,
  type AssetGroupId,
  type ManifestEntry,
  type PackDescription,
} from './PackDescription.ts';

export interface InstalledGroup {
  key: string | undefined;
  folders: string[] | undefined;
  shipped: string[] | undefined;
}

export interface InstalledPack {
  modsKey: string | undefined;
  jarNames: string[] | undefined;
  assetsKey: string | undefined;
  description: PackDescription | undefined;
  groups: Record<AssetGroupId, InstalledGroup>;
  overridesKey: string | undefined;
  extractedCrc: Record<string, number>;
  clientOptions: ClientOptions | null;
}

const OVERRIDES_NAME_BEFORE_IT_WAS_STORED = 'overrides.zip';

interface StoredSnapshot {
  resourcePacks: ManifestEntry[];
  shaderPacks: ManifestEntry[];
  overridesPresent: boolean;
  overridesKey: string;
  overridesName?: string;
  overridesSize?: number;
  overridesSha1?: string;
}

interface StoredState {
  modsEtag?: string;
  jarNames?: string[];
  modsManifest?: ManifestEntry[];
  assetsKey?: string;
  assetsSnapshot?: StoredSnapshot;
  resourcePacksKey?: string;
  resourcePackFolders?: string[];
  shaderPacksKey?: string;
  shaderPackFolders?: string[];
  overridesKey?: string;
  extractedCrc?: Record<string, number>;
  shippedFiles?: { resourcepacks?: string[]; shaderpacks?: string[] };
  clientOptions?: unknown;
  syncedAt?: number;
}

export type InstalledPackRead = { kind: 'none' } | { kind: 'unreadable'; reason: string } | { kind: 'read'; pack: InstalledPack };

export function readInstalledPack(instance: GameInstance): InstalledPackRead {
  let text: string;
  try {
    text = fs.readFileSync(instance.syncState, 'utf8');
  } catch {
    return { kind: 'none' };
  }
  let stored: StoredState;
  try {
    stored = JSON.parse(text) as StoredState;
  } catch (e) {
    return { kind: 'unreadable', reason: (e as Error).message };
  }
  if (!stored || typeof stored !== 'object') return { kind: 'unreadable', reason: 'pas un objet JSON' };
  if (stored.clientOptions === undefined) stored.clientOptions = legacyClientOptions(instance);
  return { kind: 'read', pack: fromStored(stored) };
}

function legacyClientOptions(instance: GameInstance): unknown {
  try {
    return JSON.parse(fs.readFileSync(instance.legacyClientOptions, 'utf8'));
  } catch {
    return undefined;
  }
}

export function installedPackOrEmpty(read: InstalledPackRead): InstalledPack {
  return read.kind === 'read' ? read.pack : emptyInstalledPack();
}

export function installedPackJars(instance: GameInstance): Set<string> | null {
  const read = readInstalledPack(instance);
  const names = read.kind === 'read' ? read.pack.jarNames : undefined;
  return names ? new Set(names.map((n) => n.toLowerCase())) : null;
}

export function writeInstalledPack(instance: GameInstance, pack: InstalledPack, now: number): void {
  writeFileAtomic(instance.syncState, JSON.stringify(toStored(pack, now)));
  fs.rmSync(instance.legacyClientOptions, { force: true });
}

function emptyInstalledPack(): InstalledPack {
  const group = (): InstalledGroup => ({ key: undefined, folders: undefined, shipped: undefined });
  return {
    modsKey: undefined,
    jarNames: undefined,
    assetsKey: undefined,
    description: undefined,
    groups: { resourcepacks: group(), shaderpacks: group() },
    overridesKey: undefined,
    extractedCrc: {},
    clientOptions: null,
  };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
}

function fromStored(stored: StoredState): InstalledPack {
  const snapshot = stored.assetsSnapshot;
  const description: PackDescription | undefined = snapshot
    ? {
        mods: stored.modsManifest,
        groups: {
          resourcepacks: { present: true, key: entriesKey(snapshot.resourcePacks), entries: snapshot.resourcePacks },
          shaderpacks: { present: true, key: entriesKey(snapshot.shaderPacks), entries: snapshot.shaderPacks },
        },
        overrides: snapshot.overridesPresent
          ? {
              present: true,
              key: snapshot.overridesKey,
              name: snapshot.overridesName ?? OVERRIDES_NAME_BEFORE_IT_WAS_STORED,
              size: snapshot.overridesSize ?? 0,
              ...(snapshot.overridesSha1 ? { sha1: snapshot.overridesSha1 } : {}),
            }
          : absentOverrides(),
        clientOptions: parseClientOptions(stored.clientOptions),
      }
    : undefined;
  return {
    modsKey: stored.modsEtag,
    jarNames: stringList(stored.jarNames),
    assetsKey: stored.assetsKey,
    description,
    groups: {
      resourcepacks: {
        key: stored.resourcePacksKey,
        folders: stringList(stored.resourcePackFolders),
        shipped: stringList(stored.shippedFiles?.resourcepacks),
      },
      shaderpacks: {
        key: stored.shaderPacksKey,
        folders: stringList(stored.shaderPackFolders),
        shipped: stringList(stored.shippedFiles?.shaderpacks),
      },
    },
    overridesKey: stored.overridesKey,
    extractedCrc: stored.extractedCrc && typeof stored.extractedCrc === 'object' ? { ...stored.extractedCrc } : {},
    clientOptions: parseClientOptions(stored.clientOptions),
  };
}

function toStored(pack: InstalledPack, now: number): StoredState {
  const description = pack.description;
  const groups = description?.groups ?? { resourcepacks: absentGroup(), shaderpacks: absentGroup() };
  return {
    modsEtag: pack.modsKey,
    jarNames: pack.jarNames,
    modsManifest: description?.mods,
    assetsKey: pack.assetsKey,
    assetsSnapshot: description && pack.assetsKey
      ? {
          resourcePacks: groups.resourcepacks.entries,
          shaderPacks: groups.shaderpacks.entries,
          overridesPresent: description.overrides.present,
          overridesKey: description.overrides.key,
          overridesName: description.overrides.present ? description.overrides.name : undefined,
          overridesSize: description.overrides.present ? description.overrides.size : undefined,
          overridesSha1: description.overrides.sha1,
        }
      : undefined,
    resourcePacksKey: pack.groups.resourcepacks.key,
    resourcePackFolders: pack.groups.resourcepacks.folders,
    shaderPacksKey: pack.groups.shaderpacks.key,
    shaderPackFolders: pack.groups.shaderpacks.folders,
    overridesKey: pack.overridesKey,
    extractedCrc: pack.extractedCrc,
    shippedFiles: { resourcepacks: pack.groups.resourcepacks.shipped, shaderpacks: pack.groups.shaderpacks.shipped },
    clientOptions: pack.clientOptions ?? undefined,
    syncedAt: now,
  };
}
