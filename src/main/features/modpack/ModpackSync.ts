import fs from 'fs';
import path from 'path';
import { extractZipToDir, resolveInside } from '../../shared/ZipExtract.ts';
import type { ZipEntry } from '../../shared/ZipReader.ts';
import { RangeUnsupportedError, type HttpClient } from '../../shared/HttpClient.ts';
import { githubAssetFreshness } from '../../shared/GitHubPack.ts';
import type { ClientOptions } from '../../shared/ClientOptions.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { FileVerifier } from '../integrity/FileVerifier.ts';
import { fileDigest } from '../../shared/FileDigest.ts';
import { installOverrides } from './OverridesInstaller.ts';
import {
  ASSETS_ZIP,
  ASSET_GROUPS,
  MODS_ZIP,
  extractedFolders,
  folderNameFor,
  type AssetGroup,
  type GroupManifest,
  type ManifestEntry,
  type OverridesManifest,
  type PackDescription,
} from './PackDescription.ts';
import {
  installedPackOrEmpty,
  readInstalledPack,
  writeInstalledPack,
  type InstalledGroup,
  type InstalledPack,
} from './InstalledPack.ts';
import {
  DownloadedSource,
  LooseSource,
  RangedSource,
  type FetchItem,
  type FileSource,
  type PackSource,
} from './PackSource.ts';

export type StatusEmitter = (msg: string) => void;
export type ProgressEmitter = (fraction: number) => void;

export interface PlayerSettingsKeeper {
  setRevision(revision: number): void;
  keepSettings(target: string, packCrc: number | null): Promise<boolean>;
}

export interface SyncRequest {
  baseUrl: string;
  instance: GameInstance;
  parkedJars: ReadonlySet<string>;
  playerSettings: PlayerSettingsKeeper;
  verifyAll?: boolean;
  onStatus: StatusEmitter;
  onProgress: ProgressEmitter;
}

export interface SyncResult {
  damaged: string[];
  clientOptions: ClientOptions | null;
  packJars: Set<string>;
}

export interface ModpackSyncOptions {
  http: HttpClient;
  disabledJarPrefixes?: string[];
  disabledJarReason?: string;
  fallbackClientOptions?: ClientOptions | null;
}

interface SyncDeps {
  http: HttpClient;
  disabledJarPrefixes: string[];
  disabledJarLabel: string;
  fallbackClientOptions: ClientOptions | null;
}

interface Keys {
  mods: string;
  assets: string | null;
}

interface JarTarget {
  entry: ZipEntry;
  name: string;
  target: string;
  disabled: boolean;
}

interface JarPlan {
  names: string[];
  items: FetchItem[];
  refreshed: boolean;
  keptBytes: number;
}

interface FolderUnpack {
  archive: string;
  folder: string;
}

interface GroupPlan {
  items: FetchItem[];
  folders: FolderUnpack[];
  extractedCrc: Record<string, number>;
  keptBytes: number;
}

interface OverridesPlan {
  item: FetchItem | null;
  fetchedTo: string | null;
}

export class ModpackSync {
  private readonly deps: SyncDeps;

  constructor({ http, disabledJarPrefixes, disabledJarReason, fallbackClientOptions }: ModpackSyncOptions) {
    this.deps = {
      http,
      disabledJarPrefixes: (disabledJarPrefixes ?? []).map((prefix) => prefix.toLowerCase()),
      disabledJarLabel: disabledJarReason ? `Mod client désactivé (${disabledJarReason})` : 'Mod client désactivé',
      fallbackClientOptions: fallbackClientOptions ?? null,
    };
  }

  sync(request: SyncRequest): Promise<SyncResult> {
    return new SyncRun(this.deps, request).run();
  }

}

class SyncRun {
  private readonly deps: SyncDeps;
  private readonly req: SyncRequest;
  private readonly instance: GameInstance;
  private readonly base: string;
  private readonly verifier: FileVerifier;
  private readonly installed: InstalledPack;
  private readonly shipped: Partial<Record<AssetGroup['id'], string[]>> = {};

  constructor(deps: SyncDeps, req: SyncRequest) {
    this.deps = deps;
    this.req = req;
    this.instance = req.instance;
    this.base = req.baseUrl.endsWith('/') ? req.baseUrl : req.baseUrl + '/';
    this.verifier = new FileVerifier(req.instance, { force: req.verifyAll ?? false });
    const read = readInstalledPack(req.instance);
    if (read.kind === 'unreadable') {
      req.onStatus(`État de la dernière synchronisation illisible (${read.reason}) : le pack est vérifié en entier.`);
    }
    this.installed = installedPackOrEmpty(read);
  }

  async run(): Promise<SyncResult> {
    const { instance, onStatus, onProgress } = this.req;
    for (const dir of [instance.modsDir, instance.resourcePacksDir, instance.shaderPacksDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const leftovers = instance.removeLeftoverTempFiles();
    if (leftovers > 0) onStatus(`${leftovers} fichier(s) temporaire(s) d'une synchronisation interrompue supprimé(s).`);
    onStatus(this.req.verifyAll ? 'Vérification complète des fichiers du pack...' : 'Vérification du pack...');
    onProgress(0.02);
    try {
      const keys: Keys = { mods: await this.modsKey(), assets: (await this.remoteKey(ASSETS_ZIP)).key };
      return keys.assets ? await this.runWithAssetsZip(keys, keys.assets) : await this.runLoose(keys);
    } finally {
      const failure = this.verifier.save();
      if (failure) this.req.onStatus(`Cache de vérification non enregistré : ${failure}`);
    }
  }

  private async modsKey(): Promise<string> {
    const { key, failure } = await this.remoteKey(MODS_ZIP);
    if (key) return key;
    throw new Error(
      failure
        ? `Impossible de joindre le serveur du pack (${failure}). Vérifie ta connexion, ton antivirus ou ton pare-feu.`
        : 'mods.zip indisponible (ETag/Last-Modified manquant)',
    );
  }

  private async remoteKey(name: string): Promise<{ key: string | null; failure: string | null }> {
    const url = this.base + name;
    const github = await githubAssetFreshness(this.deps.http, url);
    if (github.kind === 'found') return { key: github.key, failure: null };
    try {
      const headers = await this.deps.http.head(url);
      return { key: headerKey(headers), failure: null };
    } catch (e) {
      const reason = (e as Error).message;
      return { key: null, failure: github.kind === 'unknown' ? `${reason} ; ${github.reason}` : reason };
    }
  }

  private async runLoose(keys: Keys): Promise<SyncResult> {
    const source = new LooseSource(this.deps.http, this.base, this.instance, this.req.onStatus);
    try {
      const description = await source.describe();
      if (await this.isInstalled(description, keys.mods)) return this.alreadyInstalled(description);
      return await this.update(source, description, true, keys);
    } finally {
      source.close();
    }
  }

  private async runWithAssetsZip(keys: Keys, assetsKey: string): Promise<SyncResult> {
    const cached = this.installed.assetsKey === assetsKey ? this.installed.description ?? null : null;
    if (cached && (await this.isInstalled(cached, keys.mods))) return this.alreadyInstalled(cached);

    this.req.onStatus('Comparaison du pack avec les fichiers installés...');
    const ranged = await RangedSource.open(this.deps.http, this.base, this.instance, { mods: keys.mods, assets: assetsKey });
    if (!(ranged instanceof RangedSource)) {
      if (ranged.failure) this.announceFullDownload(ranged.failure);
      return this.updateFrom(this.downloadedSource(), cached, keys);
    }
    try {
      return await this.updateFrom(ranged, cached, keys);
    } catch (e) {
      if (!(e instanceof RangeUnsupportedError)) throw e;
      this.announceFullDownload(e.message);
      return this.updateFrom(this.downloadedSource(), cached, keys);
    }
  }

  private announceFullDownload(reason: string): void {
    this.req.onStatus(`Téléchargement partiel impossible (${reason}), téléchargement complet...`);
  }

  private downloadedSource(): DownloadedSource {
    return new DownloadedSource(this.deps.http, this.base, this.instance, this.req.onStatus);
  }

  private async updateFrom(source: PackSource, cached: PackDescription | null, keys: Keys): Promise<SyncResult> {
    try {
      return await this.update(source, cached, cached === null, keys);
    } finally {
      source.close();
    }
  }

  private alreadyInstalled(description: PackDescription): SyncResult {
    const clientOptions = this.clientOptions(description);
    this.req.playerSettings.setRevision(clientOptions?.shaderRevision ?? 0);
    this.req.onStatus('Pack déjà à jour, aucun téléchargement nécessaire.');
    this.req.onProgress(1);
    return { damaged: this.verifier.damaged, clientOptions, packJars: lowerSet(this.installed.jarNames ?? []) };
  }

  private modsKnown(modsKey: string): boolean {
    return this.installed.modsKey === modsKey && (this.installed.jarNames?.length ?? 0) > 0;
  }

  private async isInstalled(description: PackDescription, modsKey: string): Promise<boolean> {
    const checks: boolean[] = [];
    checks.push(this.modsKnown(modsKey) && (await this.damagedJars(this.installed.jarNames!, description.mods)).length === 0);
    for (const group of ASSET_GROUPS) {
      const manifest = description.groups[group.id];
      if (!manifest.present) continue;
      const sameKey = this.installed.groups[group.id].key === manifest.key;
      checks.push(sameKey && (await this.groupIntact(group, manifest)));
    }
    const overrides = description.overrides;
    if (overrides.present) {
      checks.push(
        this.installed.overridesKey === overrides.key &&
          dirExists(this.instance.configDir) &&
          (await this.verifier.isIntact(this.instance.overridesArchive, overrides)),
      );
    }
    return checks.every(Boolean);
  }

  private async groupIntact(group: AssetGroup, manifest: GroupManifest): Promise<boolean> {
    const dir = group.dirIn(this.instance);
    let intact = true;
    for (const entry of manifest.entries) {
      const target = resolveInside(dir, entry.extract ? folderNameFor(entry.name) : entry.name);
      const ok = entry.extract
        ? dirExists(target)
        : group.isPlayerSettings(entry.name)
          ? fs.existsSync(target)
          : await this.verifier.isIntact(target, entry);
      if (!ok) intact = false;
    }
    return intact;
  }

  private async update(source: PackSource, cached: PackDescription | null, fresh: boolean, keys: Keys): Promise<SyncResult> {
    const { onStatus, onProgress } = this.req;
    const modsKnown = this.modsKnown(keys.mods);
    const knownDamage = modsKnown ? await this.damagedJars(this.installed.jarNames!, cached?.mods) : [];
    let downloaded = false;
    await source.prepare(
      { mods: !modsKnown || knownDamage.length > 0, assets: cached === null, damagedJars: knownDamage.length },
      (p) => {
        downloaded = true;
        onProgress(0.05 + p * 0.55);
      },
    );
    const description = await source.describe(cached);
    const clientOptions = this.clientOptions(description);
    this.req.playerSettings.setRevision(clientOptions?.shaderRevision ?? 0);

    const jars = await this.planJars(source, description, modsKnown, knownDamage.length > 0 || !modsKnown);
    const groups = await this.planGroups(source, description, fresh);
    const overrides = await this.planOverrides(source, description.overrides, fresh);
    const items = [...jars.items, ...groups.items, ...(overrides.item ? [overrides.item] : [])];
    const bytes = source.bytesFor(items);
    if (bytes !== null) {
      onStatus(
        items.length === 0
          ? 'Tous les fichiers du pack sont déjà installés.'
          : `${items.length} fichier(s) à mettre à jour, ${formatBytes(bytes)} à télécharger ` +
              `(${formatBytes(jars.keptBytes + groups.keptBytes)} déjà installés).`,
      );
    }
    const fetchStart = downloaded ? 0.62 : 0.08;
    try {
      await source.fetch(items, (p) => onProgress(fetchStart + p * (0.93 - fetchStart)));
      await this.unpackFolders(groups.folders);
    } finally {
      for (const unpack of groups.folders) fs.rmSync(unpack.archive, { force: true });
    }

    const overridesSummary = await this.installOverrides(description.overrides, overrides.fetchedTo, fresh);
    if (jars.refreshed) this.removeExtraJars(jars.names);
    for (const group of ASSET_GROUPS) {
      const manifest = description.groups[group.id];
      if (!manifest.present) continue;
      this.removeDroppedFiles(group, manifest.entries);
      this.removeDroppedFolders(group, extractedFolders(manifest.entries));
    }
    const still = await this.damagedJars(jars.names, description.mods);
    if (still.length > 0) onStatus(`Attention: ${still.join(', ')} ne correspond(ent) pas au manifeste du pack.`);

    this.record(description, keys, jars.names, groups.extractedCrc);
    onProgress(0.98);
    const counts = ASSET_GROUPS.map((g) => `${description.groups[g.id].entries.length} ${g.countLabel}`).join(', ');
    const sent = bytes !== null ? ` (${formatBytes(bytes)} téléchargés)` : '';
    onStatus(`Pack synchronisé: ${jars.names.length} mods, ${counts}${overridesSummary}${sent}.`);
    onProgress(1);
    return { damaged: this.verifier.damaged, clientOptions, packJars: lowerSet(jars.names) };
  }

  private clientOptions(description: PackDescription): ClientOptions | null {
    return description.clientOptions ?? this.installed.clientOptions ?? this.deps.fallbackClientOptions;
  }

  private async planJars(source: PackSource, description: PackDescription, modsKnown: boolean, refresh: boolean): Promise<JarPlan> {
    const installedNames = this.installed.jarNames ?? [];
    if (!refresh) {
      const damaged = await this.damagedJars(installedNames, description.mods);
      if (damaged.length === 0) return { names: installedNames, items: [], refreshed: false, keptBytes: 0 };
      this.req.onStatus(`${damaged.length} mod(s) abîmé(s) ou manquant(s), retéléchargement de mods.zip...`);
    }
    const targets = this.jarTargets(await source.modEntries());
    const items: FetchItem[] = [];
    let keptBytes = 0;
    for (const jar of targets) {
      if (await this.verifier.matchesZipEntry(jar.target, jar.entry.size, jar.entry.crc)) {
        keptBytes += jar.entry.size;
        continue;
      }
      const label = modsKnown ? `Mod réparé: ${jar.name}` : jar.disabled ? `${this.deps.disabledJarLabel}: ${jar.name}` : `+ ${jar.name}`;
      items.push(this.entryItem({ kind: 'entry', archive: 'mods', entry: jar.entry }, jar.target, label));
    }
    return { names: targets.filter((j) => !j.disabled).map((j) => j.name), items, refreshed: true, keptBytes };
  }

  private jarTargets(entries: ZipEntry[]): JarTarget[] {
    const seen = new Set<string>();
    const jars: JarTarget[] = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      const lower = name.toLowerCase();
      if (!lower.endsWith('.jar') || seen.has(lower)) continue;
      seen.add(lower);
      const disabled = this.deps.disabledJarPrefixes.some((prefix) => lower.startsWith(prefix));
      const target = disabled
        ? resolveInside(this.instance.packDisabledModsDir, name)
        : this.instance.installedModFile(name, this.req.parkedJars.has(lower));
      jars.push({ entry, name, target, disabled });
    }
    if (!jars.some((j) => !j.disabled)) throw new Error('mods.zip ne contient aucun .jar');
    return jars;
  }

  private async damagedJars(names: string[], manifest: ManifestEntry[] | undefined): Promise<string[]> {
    const expected = new Map((manifest ?? []).map((e) => [e.name.toLowerCase(), e]));
    const damaged: string[] = [];
    for (const name of names) {
      const file = this.instance.installedModFile(name, this.req.parkedJars.has(name.toLowerCase()));
      if (!(await this.verifier.isIntact(file, expected.get(name.toLowerCase()) ?? {}))) damaged.push(name);
    }
    return damaged;
  }

  private async planGroups(source: PackSource, description: PackDescription, fresh: boolean): Promise<GroupPlan> {
    const plan: GroupPlan = { items: [], folders: [], extractedCrc: {}, keptBytes: 0 };
    for (const group of ASSET_GROUPS) {
      const manifest = description.groups[group.id];
      if (!manifest.present) continue;
      const dir = group.dirIn(this.instance);
      const keyChanged = this.installed.groups[group.id].key !== manifest.key;
      for (const entry of manifest.entries) {
        const known = fresh ? await source.assetFile(group, entry) : null;
        const crc = known?.kind === 'entry' ? known.entry.crc : undefined;
        const fileSource = async (): Promise<FileSource> => known ?? (await source.assetFile(group, entry));
        if (entry.extract) {
          const folder = resolveInside(dir, folderNameFor(entry.name));
          const key = this.instance.relative(folder);
          const previousCrc = this.installed.extractedCrc[key];
          const recordedCrc = crc ?? previousCrc;
          if (recordedCrc !== undefined) plan.extractedCrc[key] = recordedCrc;
          const stale = crc !== undefined ? previousCrc !== crc : keyChanged;
          if (dirExists(folder) && !stale) continue;
          const archive = this.instance.tempFile(entry.name, dir);
          plan.folders.push({ archive, folder });
          plan.items.push({ source: await fileSource(), target: archive });
          continue;
        }
        const target = resolveInside(dir, entry.name);
        const current = group.isPlayerSettings(entry.name)
          ? await this.req.playerSettings.keepSettings(target, crc ?? null)
          : crc !== undefined
            ? await this.verifier.matchesZipEntry(target, entry.size, crc)
            : await this.verifier.isIntact(target, entry);
        if (current) {
          plan.keptBytes += entry.size;
          continue;
        }
        plan.items.push(this.entryItem(await fileSource(), target, `+ ${entry.name}`));
      }
    }
    return plan;
  }

  private async planOverrides(source: PackSource, manifest: OverridesManifest, fresh: boolean): Promise<OverridesPlan> {
    if (!manifest.present) return { item: null, fetchedTo: null };
    const archive = this.instance.overridesArchive;
    const known = fresh ? await source.assetFile(null, manifest) : null;
    const current =
      known?.kind === 'entry'
        ? await this.verifier.matchesZipEntry(archive, manifest.size, known.entry.crc)
        : await this.verifier.isIntact(archive, manifest);
    if (current) return { item: null, fetchedTo: null };
    const fetchedTo = this.instance.tempFile(manifest.name);
    return { item: { source: known ?? (await source.assetFile(null, manifest)), target: fetchedTo }, fetchedTo };
  }

  private entryItem(source: FileSource, target: string, label: string): FetchItem {
    return {
      source,
      target,
      onFetched: () => {
        if (source.kind === 'entry') this.verifier.remember(target, source.entry.crc);
        this.req.onStatus(label);
      },
    };
  }

  private async unpackFolders(folders: FolderUnpack[]): Promise<void> {
    for (const { archive, folder } of folders) {
      fs.rmSync(folder, { recursive: true, force: true });
      await extractZipToDir(archive, folder, { stripCommonTopLevelFolder: true, durable: true });
      this.req.onStatus(`+ ${path.basename(folder)}/`);
    }
  }

  private async installOverrides(manifest: OverridesManifest, fetchedTo: string | null, fresh: boolean): Promise<string> {
    if (!manifest.present) return '';
    const archive = this.instance.overridesArchive;
    if (fetchedTo) {
      try {
        await assertMatchesManifest(fetchedTo, manifest);
        fs.renameSync(fetchedTo, archive);
      } finally {
        fs.rmSync(fetchedTo, { force: true });
      }
    }
    const keyChanged = this.installed.overridesKey !== manifest.key;
    if (!fetchedTo && !fresh && !keyChanged && dirExists(this.instance.configDir)) return '';
    this.req.onStatus('Installation des configs du pack...');
    const result = installOverrides(archive, this.instance.dir);
    this.req.onStatus(`Configs du pack: ${result.written} écrit(s), ${result.kept} conservé(s).`);
    return `, ${result.written} fichier(s) de config`;
  }

  private removeExtraJars(kept: string[]): void {
    const keptLc = lowerSet(kept);
    for (const file of fs.readdirSync(this.instance.modsDir)) {
      if (!file.toLowerCase().endsWith('.jar') || keptLc.has(file.toLowerCase())) continue;
      fs.rmSync(path.join(this.instance.modsDir, file), { force: true });
      this.req.onStatus(`Mod supprimé: ${file}`);
    }
  }

  private removeDroppedFiles(group: AssetGroup, entries: ManifestEntry[]): void {
    const dir = group.dirIn(this.instance);
    const current = entries.filter((e) => !e.extract).map((e) => e.name);
    const currentLc = lowerSet(current);
    for (const name of this.installed.groups[group.id].shipped ?? []) {
      if (currentLc.has(name.toLowerCase())) continue;
      const file = path.resolve(dir, name);
      if (!isInside(dir, file) || !isFile(file)) continue;
      fs.rmSync(file, { force: true });
      this.req.onStatus(`${group.removedLabel}: ${name}`);
    }
    this.shipped[group.id] = current;
  }

  private removeDroppedFolders(group: AssetGroup, current: string[]): void {
    const dir = group.dirIn(this.instance);
    const keepLc = lowerSet(current);
    for (const name of this.installed.groups[group.id].folders ?? []) {
      if (keepLc.has(name.toLowerCase())) continue;
      const folder = path.resolve(dir, name);
      if (!isInside(dir, folder) || !dirExists(folder)) continue;
      fs.rmSync(folder, { recursive: true, force: true });
      this.req.onStatus(`${group.removedLabel}: ${name}/`);
    }
  }

  private record(description: PackDescription, keys: Keys, jarNames: string[], extractedCrc: Record<string, number>): void {
    const groupRecord = (group: AssetGroup): InstalledGroup => {
      const manifest = description.groups[group.id];
      if (!manifest.present) return this.installed.groups[group.id];
      return { key: manifest.key, folders: extractedFolders(manifest.entries), shipped: this.shipped[group.id] };
    };
    const pack: InstalledPack = {
      modsKey: keys.mods,
      jarNames,
      assetsKey: keys.assets ?? undefined,
      description: keys.assets ? description : undefined,
      groups: { resourcepacks: groupRecord(ASSET_GROUPS[0]), shaderpacks: groupRecord(ASSET_GROUPS[1]) },
      overridesKey: description.overrides.present ? description.overrides.key : this.installed.overridesKey,
      extractedCrc: { ...this.installed.extractedCrc, ...extractedCrc },
      clientOptions: description.clientOptions ?? this.installed.clientOptions,
    };
    try {
      writeInstalledPack(this.instance, pack, Date.now());
    } catch (e) {
      this.req.onStatus(`Attention: état de la synchronisation non enregistré (${(e as Error).message}).`);
    }
  }
}

async function assertMatchesManifest(file: string, manifest: OverridesManifest): Promise<void> {
  const actual = fs.statSync(file).size;
  if (actual !== manifest.size) throw new Error(`${manifest.name}: taille ${actual} au lieu de ${manifest.size}`);
  if (manifest.sha1 && (await fileDigest(file, 'sha1')) !== manifest.sha1) throw new Error(`${manifest.name}: empreinte SHA-1 invalide`);
}

function headerKey(headers: Record<string, string | string[] | undefined>): string | null {
  const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '');
  const etag = first(headers['etag'] ?? headers['last-modified']);
  if (etag) return etag;
  const length = first(headers['content-length']);
  return length ? `len-${length}` : null;
}

function lowerSet(names: string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isInside(dir: string, target: string): boolean {
  const root = path.resolve(dir);
  return target.startsWith(root + path.sep);
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
  return `${Math.max(1, Math.round(n / 1024))} Ko`;
}
