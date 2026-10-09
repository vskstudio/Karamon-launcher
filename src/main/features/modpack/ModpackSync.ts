import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { commonTopLevelPrefix, extractZipToDir, resolveInside } from '../../shared/ZipExtract.ts';
import { ZipReader, type ZipEntry } from '../../shared/ZipReader.ts';
import { RemoteZip } from '../../shared/RemoteZip.ts';
import { fetchDelta, formatBytes, planDelta, type DeltaFile } from './DeltaPack.ts';
import { copyFileAtomic, writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { githubAssetFreshness, packAssetUrl } from '../../shared/GitHubPack.ts';
import { OptionsWriter } from '../minecraft/OptionsWriter.ts';
import { applyKaramonBranding } from '../minecraft/BrandingWriter.ts';
import { ShaderPolicy } from '../minecraft/ShaderChoice.ts';
import { parseClientOptions, type ClientOptions } from '../../shared/ClientOptions.ts';
import { installOverrides } from './OverridesInstaller.ts';
import { FileVerifier, crc32File, sha1File, type ExpectedFile } from '../integrity/FileVerifier.ts';

const CACHE_FILE = '.karamon-sync-cache.json';
const MODS_ZIP_NAME = 'mods.zip';
const MODS_ZIP_TMP = '.karamon-mods.zip';
// One {name, size, sha1} per jar inside mods.zip. Optional: older packs don't publish it.
const MODS_MANIFEST = 'mods-manifest.json';
const ASSETS_ZIP_NAME = 'assets.zip';
const ASSETS_ZIP_TMP = '.karamon-assets.zip';
const ASSETS_EXTRACT_DIR = '.karamon-assets';
const RESOURCE_PACKS_MANIFEST = 'resourcepacks-manifest.json';
const RESOURCE_PACKS_PATH_PREFIX = 'resourcepacks/';
const SHADER_PACKS_MANIFEST = 'shaderpacks-manifest.json';
const SHADER_PACKS_PATH_PREFIX = 'shaderpacks/';
// Cobbleverse instance overrides (config/, datapacks/) that Prism gets from the pack
// import. Published as one zip + manifest; absent manifest = nothing to install.
const OVERRIDES_MANIFEST = 'overrides-manifest.json';
// Kept after install: the config repair restores zero-filled files from it.
const OVERRIDES_ARCHIVE = '.karamon-overrides.zip';
const CLIENT_OPTIONS_NAME = 'client-options.json';
const CLIENT_OPTIONS_CACHE = '.karamon-client-options.json';
const PARALLEL_DOWNLOADS = 8;
const ZIP_DOWNLOAD_TIMEOUT_MS = 1200000;
const SHA1_HEX = /^[0-9a-f]{40}$/i;
/**
 * A pack jar the player's settings keep switched off (mode PC modeste) lives in
 * mods/ as `<name>.jar.disabled`: Fabric skips it, and the sync verifies and
 * repairs that file instead of putting the `.jar` back.
 */
export const PARKED_JAR_SUFFIX = '.disabled';

export type StatusEmitter = (msg: string) => void;
export type ProgressEmitter = (fraction: number) => void;

interface ManifestEntry {
  name: string;
  size: number;
  sha1?: string;
  extract?: boolean;
}

interface OptionalManifest {
  present: boolean;
  key: string;
  entries: ManifestEntry[];
}

interface OverridesManifest {
  present: boolean;
  key: string;
  name: string;
  size: number;
  sha1?: string;
}

interface SyncDirs {
  mods: string;
  resourcepacks: string;
  shaderpacks: string;
}

interface AssetsSnapshot {
  resourcePacks: ManifestEntry[];
  shaderPacks: ManifestEntry[];
  overridesPresent: boolean;
  overridesKey: string;
  overridesSize?: number;
  overridesSha1?: string;
}

interface CacheData {
  modsEtag?: string;
  jarNames?: string[];
  modsManifest?: ManifestEntry[];
  assetsKey?: string;
  assetsSnapshot?: AssetsSnapshot;
  resourcePacksKey?: string;
  resourcePackFolders?: string[];
  shaderPacksKey?: string;
  shaderPackFolders?: string[];
  overridesKey?: string;
  /** Folder (relative to the game dir) → CRC-32 of the pack zip it was unpacked from. */
  extractedCrc?: Record<string, number>;
  /** Loose files the pack installed in resourcepacks/ and shaderpacks/: the only ones a sync may delete. */
  shippedFiles?: { resourcepacks?: string[]; shaderpacks?: string[] };
  syncedAt?: number;
}

export interface SyncOptions {
  /** Rehash every pack file, ignoring the hash cache. */
  verifyAll?: boolean;
}

export interface SyncReport {
  /** Pack files found on disk but damaged, then reinstalled (relative to the game dir). */
  damaged: string[];
}

interface JarRepairContext {
  zipUrl: string;
  zipPath: string;
  zipReady: boolean;
  modsDir: string;
  jarNames: string[];
  manifest: ManifestEntry[] | undefined;
  verifier: FileVerifier;
  onStatus: StatusEmitter;
}

export interface ModpackSyncOptions {
  http: HttpClient;
  optionsWriterFactory: (dir: string) => OptionsWriter;
  disabledJarPrefixes?: string[];
  fallbackClientOptions?: ClientOptions | null;
  /** Pack jars kept as `<name>.disabled` in this game folder (see PARKED_JAR_SUFFIX). */
  parkedJars?: (gameDir: string) => Iterable<string>;
}

export class ModpackSync {
  private readonly http: HttpClient;
  private readonly optionsWriterFactory: (dir: string) => OptionsWriter;
  private readonly disabledJarPrefixes: string[];
  private readonly fallbackClientOptions: ClientOptions | null;
  private readonly parkedJars: (gameDir: string) => Iterable<string>;
  /** Lowercase names of the jars parked for the sync in progress. */
  private parked = new Set<string>();
  /** Shader choice policy of the sync in progress. */
  private shaders: ShaderPolicy = new ShaderPolicy('');
  /** Loose pack files installed, per folder, for the sync in progress (see cleanupPackFiles). */
  private shipped: { resourcepacks?: string[]; shaderpacks?: string[] } = {};

  constructor({
    http,
    optionsWriterFactory,
    disabledJarPrefixes,
    fallbackClientOptions,
    parkedJars,
  }: ModpackSyncOptions) {
    this.http = http;
    this.optionsWriterFactory = optionsWriterFactory;
    this.disabledJarPrefixes = (disabledJarPrefixes ?? []).map((prefix) => prefix.toLowerCase());
    this.fallbackClientOptions = fallbackClientOptions ?? null;
    this.parkedJars = parkedJars ?? (() => []);
  }

  /** Enabled jars of the pack as last installed (lowercase), or null before the first sync. */
  static packJars(gameDir: string): Set<string> | null {
    try {
      const cache = JSON.parse(fs.readFileSync(path.join(gameDir, CACHE_FILE), 'utf8')) as CacheData;
      return Array.isArray(cache.jarNames) ? ModpackSync.lowerSet(cache.jarNames) : null;
    } catch {
      return null;
    }
  }

  /** The pack's overrides archive as last installed, or null if none is kept. */
  static overridesArchive(gameDir: string): string | null {
    const file = path.join(gameDir, OVERRIDES_ARCHIVE);
    return fs.existsSync(file) ? file : null;
  }

  static listMods(gameDir: string): { name: string; size: number; disabled?: boolean }[] {
    const dir = path.join(gameDir, 'mods');
    const parked = '.jar' + PARKED_JAR_SUFFIX;
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.jar') || f.toLowerCase().endsWith(parked))
        .map((file) => {
          let size = 0;
          try {
            size = fs.statSync(path.join(dir, file)).size;
          } catch {
            /* ignore */
          }
          if (!file.toLowerCase().endsWith(parked)) return { name: file, size };
          return { name: file.slice(0, -PARKED_JAR_SUFFIX.length), size, disabled: true };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async sync(
    baseUrl: string,
    gameDir: string,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
    { verifyAll = false }: SyncOptions = {},
  ): Promise<SyncReport> {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const dirs = this.ensureDirs(gameDir);
    const zipUrl = base + MODS_ZIP_NAME;
    const verifier = new FileVerifier(gameDir, { force: verifyAll });

    onStatus(verifyAll ? 'Vérification complète des fichiers du pack...' : 'Vérification du pack...');
    onProgress(0.02);

    const githubKey = await githubAssetFreshness(this.http, zipUrl);
    let headers: Record<string, string | string[] | undefined> = {};
    if (!githubKey) {
      try {
        headers = await this.http.head(zipUrl);
      } catch {
        /* GitHub refuse parfois HEAD; on bascule sur la taille */
      }
    }
    const etag =
      githubKey ||
      ModpackSync.extractEtag(headers) ||
      ModpackSync.extractLengthKey(headers);
    if (!etag) {
      throw new Error('mods.zip indisponible (ETag/Last-Modified manquant)');
    }

    const cache = this.readCache(gameDir);
    this.parked = this.readParked(gameDir);
    this.shaders = new ShaderPolicy(gameDir);
    this.shipped = { ...(cache.shippedFiles ?? {}) };
    try {
      const assetsKey = await this.probeAssetsZip(base);
      if (assetsKey) {
        await this.syncWithAssetsZip(base, gameDir, dirs, etag, assetsKey, cache, verifier, onStatus, onProgress);
      } else {
        await this.syncLooseFiles(base, gameDir, dirs, etag, cache, verifier, onStatus, onProgress);
      }
    } finally {
      verifier.save();
      this.shaders.save();
    }
    return { damaged: verifier.damaged };
  }

  /**
   * Writes the pack's options: resource pack order every time (pack rule), the
   * shader choice only when ShaderPolicy says the pack must impose it.
   */
  private applyClientOptions(gameDir: string, options: ClientOptions | null, onStatus?: StatusEmitter): void {
    const writer = this.optionsWriterFactory(gameDir);
    try {
      if (options) {
        writer.forceResourcePacks(options.resourcePacks);
        const applied = this.shaders.applyChoice(writer, options.shaderPack, options.enableShaders, options.shaderRevision);
        if (applied && this.shaders.bumped) onStatus?.(`Shader du pack appliqué : ${options.shaderPack}.`);
      }
      applyKaramonBranding(gameDir, options?.resourcePacks);
    } catch {
      /* non-fatal */
    }
  }

  private async syncLooseFiles(
    base: string,
    gameDir: string,
    dirs: SyncDirs,
    etag: string,
    cache: CacheData,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<void> {
    const zipUrl = base + MODS_ZIP_NAME;
    const resourcePacks = await this.fetchOptionalManifest(base, RESOURCE_PACKS_MANIFEST);
    const shaderPacks = await this.fetchOptionalManifest(base, SHADER_PACKS_MANIFEST);
    const modsManifest = await this.fetchOptionalManifest(base, MODS_MANIFEST);
    const overrides = await this.fetchOverridesManifest(base);
    const clientOptions = await this.fetchClientOptions(base, gameDir);
    this.shaders.setRevision(clientOptions?.shaderRevision ?? 0);
    const jarManifest = modsManifest.present ? modsManifest.entries : undefined;

    const modsKnown = ModpackSync.modsKnown(cache, etag);
    const damagedJars = modsKnown
      ? await this.damagedJars(dirs.mods, cache.jarNames ?? [], jarManifest, verifier)
      : [];
    const modsUpToDate = modsKnown && damagedJars.length === 0;
    const resourcePacksUpToDate = await this.manifestGroupUpToDate(
      cache.resourcePacksKey,
      resourcePacks,
      dirs.resourcepacks,
      verifier,
    );
    const shaderPacksUpToDate = await this.manifestGroupUpToDate(
      cache.shaderPacksKey,
      shaderPacks,
      dirs.shaderpacks,
      verifier,
    );
    const overridesUpToDate =
      !overrides.present ||
      (cache.overridesKey === overrides.key &&
        ModpackSync.dirExists(path.join(gameDir, 'config')) &&
        (await verifier.isIntact(path.join(gameDir, OVERRIDES_ARCHIVE), overrides)));

    const applyOptions = (): void => this.applyClientOptions(gameDir, clientOptions, onStatus);

    if (modsUpToDate && resourcePacksUpToDate && shaderPacksUpToDate && overridesUpToDate) {
      applyOptions();
      onStatus('Pack déjà à jour, aucun téléchargement nécessaire.');
      onProgress(1);
      return;
    }

    let jarNames: string[] = cache.jarNames ?? [];

    if (!modsUpToDate) {
      const zipPath = path.join(gameDir, MODS_ZIP_TMP);
      try {
        onStatus(
          modsKnown
            ? `${damagedJars.length} mod(s) abîmé(s) ou manquant(s), retéléchargement de mods.zip...`
            : 'Téléchargement de mods.zip...',
        );
        await this.http.download(zipUrl, zipPath, {
          label: MODS_ZIP_NAME,
          timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
          onProgress: (p) => onProgress(0.05 + p * 0.55),
        });

        onProgress(0.62);
        if (!modsKnown) {
          onStatus('Extraction des mods...');
          jarNames = await this.extractJars(zipPath, dirs.mods, onStatus);
          this.cleanupExtras(dirs.mods, jarNames, '.jar', onStatus, 'Mod supprimé');
        }
        await this.repairJars({
          zipUrl,
          zipPath,
          zipReady: true,
          modsDir: dirs.mods,
          jarNames,
          manifest: jarManifest,
          verifier,
          onStatus,
        });
      } finally {
        fs.rmSync(zipPath, { force: true });
      }
    }
    onProgress(0.68);

    if (resourcePacks.present) {
      await this.syncManifestGroup(
        resourcePacks,
        dirs.resourcepacks,
        base,
        RESOURCE_PACKS_PATH_PREFIX,
        'resource packs',
        'Resource pack supprimé',
        cache.resourcePackFolders,
        cache.resourcePacksKey !== resourcePacks.key,
        verifier,
        onStatus,
        onProgress,
        0.7,
        0.13,
      );
    } else {
      onProgress(0.83);
    }

    if (shaderPacks.present) {
      await this.syncManifestGroup(
        shaderPacks,
        dirs.shaderpacks,
        base,
        SHADER_PACKS_PATH_PREFIX,
        'shader packs',
        'Shader pack supprimé',
        cache.shaderPackFolders,
        cache.shaderPacksKey !== shaderPacks.key,
        verifier,
        onStatus,
        onProgress,
        0.84,
        0.1,
      );
    } else {
      onProgress(0.94);
    }

    let overridesSummary = '';
    if (overrides.present && !overridesUpToDate) {
      const result = await this.syncOverrides(overrides, gameDir, base, onStatus, onProgress, 0.94, 0.04);
      overridesSummary = `, ${result.written} fichier(s) de config`;
    }
    onProgress(0.98);

    applyOptions();

    this.writeCache(gameDir, {
      modsEtag: etag,
      jarNames,
      modsManifest: jarManifest,
      resourcePacksKey: resourcePacks.present ? resourcePacks.key : cache.resourcePacksKey,
      resourcePackFolders: resourcePacks.present
        ? ModpackSync.extractedFolders(resourcePacks.entries)
        : cache.resourcePackFolders,
      shaderPacksKey: shaderPacks.present ? shaderPacks.key : cache.shaderPacksKey,
      shaderPackFolders: shaderPacks.present
        ? ModpackSync.extractedFolders(shaderPacks.entries)
        : cache.shaderPackFolders,
      overridesKey: overrides.present ? overrides.key : cache.overridesKey,
      syncedAt: Date.now(),
    });
    onStatus(
      `Pack synchronisé: ${jarNames.length} mods, ` +
        `${resourcePacks.entries.length} resource packs, ${shaderPacks.entries.length} shaders${overridesSummary}.`,
    );
    onProgress(1);
  }

  private async fetchOverridesManifest(baseUrl: string): Promise<OverridesManifest> {
    try {
      return ModpackSync.parseOverridesManifest(await this.http.getText(baseUrl + OVERRIDES_MANIFEST));
    } catch {
      return ModpackSync.absentOverrides();
    }
  }

  private async syncOverrides(
    manifest: OverridesManifest,
    gameDir: string,
    baseUrl: string,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
    progressStart: number,
    progressSpan: number,
  ): Promise<{ written: number; kept: number }> {
    onStatus('Téléchargement des configs du pack...');
    const archive = path.join(gameDir, OVERRIDES_ARCHIVE);
    try {
      await this.http.download(packAssetUrl(baseUrl, manifest.name), archive, {
        label: manifest.name,
        onProgress: (p) => onProgress(progressStart + progressSpan * p),
      });
      const actual = fs.statSync(archive).size;
      if (actual !== manifest.size) {
        throw new Error(`${manifest.name}: taille ${actual} au lieu de ${manifest.size}`);
      }
      if (manifest.sha1 && (await sha1File(archive)) !== manifest.sha1) {
        throw new Error(`${manifest.name}: empreinte SHA-1 invalide`);
      }
    } catch (e) {
      fs.rmSync(archive, { force: true });
      throw e;
    }
    onStatus('Installation des configs du pack...');
    const result = installOverrides(archive, gameDir);
    onStatus(`Configs du pack: ${result.written} écrit(s), ${result.kept} conservé(s).`);
    return result;
  }

  private ensureDirs(gameDir: string): SyncDirs {
    const dirs: SyncDirs = {
      mods: path.join(gameDir, 'mods'),
      resourcepacks: path.join(gameDir, 'resourcepacks'),
      shaderpacks: path.join(gameDir, 'shaderpacks'),
    };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
    return dirs;
  }

  private static extractEtag(headers: Record<string, string | string[] | undefined>): string {
    const raw = headers['etag'] ?? headers['last-modified'];
    if (Array.isArray(raw)) return raw[0] ?? '';
    return typeof raw === 'string' ? raw : '';
  }

  private static extractLengthKey(headers: Record<string, string | string[] | undefined>): string {
    const raw = headers['content-length'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.length > 0 ? `len-${value}` : '';
  }

  /** mods.zip unchanged since the last install: only damaged jars need work. */
  private static modsKnown(cache: CacheData, etag: string): boolean {
    return cache.modsEtag === etag && Array.isArray(cache.jarNames) && cache.jarNames.length > 0;
  }

  /**
   * Where each jar of mods.zip goes: enabled jars to mods/, jars matching a
   * disabled prefix to mods/mods-disabled/. First occurrence of a name wins.
   */
  private jarTargets(entries: ZipEntry[], modsDir: string): { entry: ZipEntry; name: string; target: string; disabled: boolean }[] {
    const seen = new Set<string>();
    const out: { entry: ZipEntry; name: string; target: string; disabled: boolean }[] = [];
    const disabledDir = path.join(modsDir, 'mods-disabled');
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      const lower = name.toLowerCase();
      if (!lower.endsWith('.jar') || seen.has(lower)) continue;
      seen.add(lower);
      const disabled = this.isDisabledJar(name);
      const target = disabled
        ? ModpackSync.safeJoin(disabledDir, name)
        : ModpackSync.safeJoin(modsDir, this.installedName(name));
      out.push({ entry, name, disabled, target });
    }
    if (!out.some((j) => !j.disabled)) {
      throw new Error('mods.zip ne contient aucun .jar');
    }
    return out;
  }

  /**
   * Writes the jars of mods.zip and returns the enabled jar names. With `only`
   * (lowercase names), every jar is still listed but only those are rewritten.
   */
  private extractJars(
    zipPath: string,
    modsDir: string,
    onStatus: StatusEmitter,
    only?: Set<string>,
  ): Promise<string[]> {
    return ZipReader.withAsync(zipPath, async (zip) => {
      const jars = this.jarTargets(zip.entries, modsDir);
      for (const jar of jars) {
        if (jar.disabled) {
          if (only) continue;
          await zip.extractTo(jar.entry, jar.target, { durable: true });
          onStatus(`Mod client désactivé (Java 21): ${jar.name}`);
          continue;
        }
        if (only && !only.has(jar.name.toLowerCase())) continue;
        await zip.extractTo(jar.entry, jar.target, { durable: true });
        if (only) onStatus(`Mod réparé: ${jar.name}`);
      }
      return jars.filter((j) => !j.disabled).map((j) => j.name);
    });
  }

  /**
   * Enabled jars that are missing or damaged. Jars moved to mods-disabled are
   * listed by the manifest too but are never loaded, so they are skipped. A
   * parked jar is checked under its `.disabled` name.
   */
  private async damagedJars(
    modsDir: string,
    jarNames: string[],
    manifest: ManifestEntry[] | undefined,
    verifier: FileVerifier,
  ): Promise<string[]> {
    const expected = new Map((manifest ?? []).map((e) => [e.name.toLowerCase(), e]));
    const damaged: string[] = [];
    for (const name of jarNames) {
      const entry = expected.get(name.toLowerCase());
      if (!(await verifier.isIntact(path.join(modsDir, this.installedName(name)), entry ?? {}))) damaged.push(name);
    }
    return damaged;
  }

  /** Verifies the installed jars and rewrites the damaged ones from mods.zip. */
  private async repairJars(ctx: JarRepairContext): Promise<void> {
    const damaged = await this.damagedJars(ctx.modsDir, ctx.jarNames, ctx.manifest, ctx.verifier);
    if (damaged.length === 0) return;
    if (!ctx.zipReady) {
      ctx.onStatus(`${damaged.length} mod(s) abîmé(s) ou manquant(s), retéléchargement de mods.zip...`);
      await this.http.download(ctx.zipUrl, ctx.zipPath, {
        label: MODS_ZIP_NAME,
        timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
      });
    }
    await this.extractJars(ctx.zipPath, ctx.modsDir, ctx.onStatus, ModpackSync.lowerSet(damaged));
    const still = await this.damagedJars(ctx.modsDir, damaged, ctx.manifest, ctx.verifier);
    if (still.length > 0) {
      ctx.onStatus(`Attention: ${still.join(', ')} ne correspond(ent) pas au manifeste du pack.`);
    }
  }

  /** File name of a pack jar in mods/: `<name>.disabled` while it is parked. */
  private installedName(name: string): string {
    return this.parked.has(name.toLowerCase()) ? name + PARKED_JAR_SUFFIX : name;
  }

  private readParked(gameDir: string): Set<string> {
    try {
      return ModpackSync.lowerSet([...this.parkedJars(gameDir)]);
    } catch {
      return new Set();
    }
  }

  private isDisabledJar(name: string): boolean {
    const lower = name.toLowerCase();
    return this.disabledJarPrefixes.some((prefix) => lower.startsWith(prefix));
  }

  private async fetchClientOptions(baseUrl: string, gameDir?: string): Promise<ClientOptions | null> {
    try {
      const text = await this.http.getText(baseUrl + CLIENT_OPTIONS_NAME);
      const parsed = parseClientOptions(JSON.parse(text));
      if (parsed) return parsed;
    } catch {
      /* try local cache / fallback */
    }
    return this.loadStoredClientOptions(gameDir);
  }

  private loadStoredClientOptions(gameDir?: string): ClientOptions | null {
    if (gameDir) {
      try {
        const parsed = parseClientOptions(
          JSON.parse(fs.readFileSync(path.join(gameDir, CLIENT_OPTIONS_CACHE), 'utf8')),
        );
        if (parsed) return parsed;
      } catch {
        /* fallback below */
      }
    }
    return this.fallbackClientOptions;
  }

  private storeClientOptions(gameDir: string, options: ClientOptions | null): void {
    if (!options) return;
    try {
      writeFileAtomic(path.join(gameDir, CLIENT_OPTIONS_CACHE), JSON.stringify(options));
    } catch {
      /* best-effort */
    }
  }

  private async probeAssetsZip(baseUrl: string): Promise<string | null> {
    const url = baseUrl + ASSETS_ZIP_NAME;
    const githubKey = await githubAssetFreshness(this.http, url);
    if (githubKey) return githubKey;
    try {
      const headers = await this.http.head(url);
      return ModpackSync.extractEtag(headers) || ModpackSync.extractLengthKey(headers) || null;
    } catch {
      return null;
    }
  }

  private async syncWithAssetsZip(
    baseUrl: string,
    gameDir: string,
    dirs: SyncDirs,
    modsEtag: string,
    assetsKey: string,
    cache: CacheData,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
  ): Promise<void> {
    const modsKnown = ModpackSync.modsKnown(cache, modsEtag);
    const snapshot = cache.assetsKey === assetsKey ? cache.assetsSnapshot : undefined;
    const assetsUpToDate = !!snapshot && (await this.assetsIntact(dirs, gameDir, snapshot, verifier));
    // The jar manifest ships inside assets.zip: the cached one is current only with it.
    let jarManifest = assetsUpToDate ? cache.modsManifest : undefined;
    const damagedJars = modsKnown && assetsUpToDate
      ? await this.damagedJars(dirs.mods, cache.jarNames ?? [], jarManifest, verifier)
      : [];
    const modsUpToDate = modsKnown && damagedJars.length === 0;

    const applyOptions = (options: ClientOptions | null): void => this.applyClientOptions(gameDir, options, onStatus);

    if (modsUpToDate && assetsUpToDate) {
      applyOptions(this.loadStoredClientOptions(gameDir));
      onStatus('Pack déjà à jour, aucun téléchargement nécessaire.');
      onProgress(1);
      return;
    }

    try {
      const done = await this.syncDelta(baseUrl, gameDir, dirs, modsEtag, assetsKey, cache, verifier, {
        modsUpToDate,
        assetsUpToDate,
        snapshot,
        onStatus,
        onProgress,
      });
      if (done) {
        applyOptions(done.clientOptions);
        return;
      }
    } catch (e) {
      onStatus(`Téléchargement partiel impossible (${(e as Error).message}), téléchargement complet...`);
    }

    let jarNames: string[] = cache.jarNames ?? [];
    let installed = snapshot;
    let clientOptions = this.loadStoredClientOptions(gameDir);
    let overridesSummary = '';
    const modsZipPath = path.join(gameDir, MODS_ZIP_TMP);
    const assetsZipPath = path.join(gameDir, ASSETS_ZIP_TMP);
    let modsP = modsUpToDate ? 1 : 0;
    let assetsP = assetsUpToDate ? 1 : 0;
    const reportDownloads = (): void => {
      onProgress(0.05 + modsP * 0.4 + assetsP * 0.28);
    };
    try {
      const jobs: Promise<void>[] = [];
      if (!modsUpToDate) {
        jobs.push(
          this.http.download(baseUrl + MODS_ZIP_NAME, modsZipPath, {
            label: MODS_ZIP_NAME,
            timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
            onProgress: (p) => {
              modsP = p;
              reportDownloads();
            },
          }),
        );
      }
      if (!assetsUpToDate) {
        jobs.push(
          this.http.download(baseUrl + ASSETS_ZIP_NAME, assetsZipPath, {
            label: ASSETS_ZIP_NAME,
            timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
            onProgress: (p) => {
              assetsP = p;
              reportDownloads();
            },
          }),
        );
      }
      if (damagedJars.length > 0) {
        onStatus(`${damagedJars.length} mod(s) abîmé(s) ou manquant(s), retéléchargement de mods.zip...`);
      } else if (jobs.length === 2) {
        onStatus('Téléchargement de mods.zip et assets.zip...');
      } else if (!modsUpToDate) {
        onStatus('Téléchargement de mods.zip...');
      } else {
        onStatus('Téléchargement de assets.zip...');
      }
      await Promise.all(jobs);

      if (!modsKnown) {
        onStatus('Extraction des mods...');
        onProgress(0.75);
        jarNames = await this.extractJars(modsZipPath, dirs.mods, onStatus);
        this.cleanupExtras(dirs.mods, jarNames, '.jar', onStatus, 'Mod supprimé');
      }
      if (!assetsUpToDate) {
        const result = await this.installAssetsFromZip(assetsZipPath, gameDir, dirs, cache, verifier, onStatus);
        installed = result.snapshot;
        jarManifest = result.modsManifest;
        clientOptions = result.clientOptions ?? clientOptions;
        overridesSummary = result.overridesSummary;
      }
      await this.repairJars({
        zipUrl: baseUrl + MODS_ZIP_NAME,
        zipPath: modsZipPath,
        zipReady: !modsUpToDate,
        modsDir: dirs.mods,
        jarNames,
        manifest: jarManifest,
        verifier,
        onStatus,
      });
    } finally {
      fs.rmSync(modsZipPath, { force: true });
      fs.rmSync(assetsZipPath, { force: true });
    }
    onProgress(0.98);
    applyOptions(clientOptions);

    this.writeCache(gameDir, {
      modsEtag,
      jarNames,
      modsManifest: jarManifest,
      assetsKey,
      assetsSnapshot: installed,
      resourcePacksKey: installed ? ModpackSync.hashEntries(installed.resourcePacks) : cache.resourcePacksKey,
      resourcePackFolders: installed
        ? ModpackSync.extractedFolders(installed.resourcePacks)
        : cache.resourcePackFolders,
      shaderPacksKey: installed ? ModpackSync.hashEntries(installed.shaderPacks) : cache.shaderPacksKey,
      shaderPackFolders: installed
        ? ModpackSync.extractedFolders(installed.shaderPacks)
        : cache.shaderPackFolders,
      overridesKey: installed?.overridesKey ?? cache.overridesKey,
      syncedAt: Date.now(),
    });
    const rpCount = installed?.resourcePacks.length ?? 0;
    const spCount = installed?.shaderPacks.length ?? 0;
    onStatus(`Pack synchronisé: ${jarNames.length} mods, ${rpCount} resource packs, ${spCount} shaders${overridesSummary}.`);
    onProgress(1);
  }

  /**
   * Updates the pack by reading mods.zip and assets.zip in place on the server
   * (HTTP ranges): only the files whose size or CRC differs from the installed
   * ones are downloaded, straight to their final place. Returns null when the
   * server cannot do ranged reads (caller falls back to full downloads); throws
   * if a ranged read breaks midway (caller falls back too).
   *
   * Resource and shader packs that ship as zips to unpack into folders, and the
   * overrides archive, have no file to compare with: they are fetched whenever
   * the archive's entry changed, otherwise kept.
   */
  private async syncDelta(
    baseUrl: string,
    gameDir: string,
    dirs: SyncDirs,
    modsEtag: string,
    assetsKey: string,
    cache: CacheData,
    verifier: FileVerifier,
    ctx: {
      modsUpToDate: boolean;
      assetsUpToDate: boolean;
      snapshot: AssetsSnapshot | undefined;
      onStatus: StatusEmitter;
      onProgress: ProgressEmitter;
    },
  ): Promise<{ clientOptions: ClientOptions | null } | null> {
    const { onStatus, onProgress } = ctx;
    onStatus('Comparaison du pack avec les fichiers installés...');
    let modsZip: RemoteZip;
    let assetsZip: RemoteZip;
    try {
      [modsZip, assetsZip] = await Promise.all([
        RemoteZip.open(this.http, baseUrl + MODS_ZIP_NAME),
        RemoteZip.open(this.http, baseUrl + ASSETS_ZIP_NAME),
      ]);
    } catch (e) {
      if ((e as Error).name === 'RangeUnsupportedError') return null;
      throw e;
    }
    // The archives changed between the HEAD probe and now: the full path copes with that.
    if (modsZip.etag !== modsEtag || assetsZip.etag !== assetsKey) return null;
    onProgress(0.06);

    const assets = new Map(
      assetsZip.entries
        .filter((e) => !e.isDirectory)
        .map((e) => [ModpackSync.stripTop(assetsZip.entries, e.entryName), e] as const),
    );
    const readSmall = async (name: string): Promise<string | null> => {
      const entry = assets.get(name);
      if (!entry) return null;
      const tmp = path.join(gameDir, `.karamon-delta-${process.pid}-${path.basename(name)}`);
      try {
        await assetsZip.extractTo(entry, tmp);
        return fs.readFileSync(tmp, 'utf8');
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    };
    const [rpText, spText, modsText, overridesText, optionsText] = await Promise.all([
      readSmall(RESOURCE_PACKS_MANIFEST),
      readSmall(SHADER_PACKS_MANIFEST),
      readSmall(MODS_MANIFEST),
      readSmall(OVERRIDES_MANIFEST),
      readSmall(CLIENT_OPTIONS_NAME),
    ]);
    const asManifest = (text: string | null, label: string): OptionalManifest =>
      text === null
        ? { present: false, key: '', entries: [] }
        : { present: true, key: ModpackSync.hashText(text), entries: ModpackSync.parseManifest(text, label) };
    const resourcePacks = asManifest(rpText, RESOURCE_PACKS_MANIFEST);
    const shaderPacks = asManifest(spText, SHADER_PACKS_MANIFEST);
    const modsManifest = asManifest(modsText, MODS_MANIFEST);
    let overrides = ModpackSync.absentOverrides();
    if (overridesText !== null) {
      try {
        overrides = ModpackSync.parseOverridesManifest(overridesText);
      } catch {
        /* treated as absent, like the full path */
      }
    }
    let clientOptions: ClientOptions | null = this.fallbackClientOptions;
    if (optionsText !== null) {
      try {
        clientOptions = parseClientOptions(JSON.parse(optionsText)) ?? this.fallbackClientOptions;
      } catch {
        /* fallback */
      }
    }

    const files: DeltaFile[] = [];
    const jars = this.jarTargets(modsZip.entries, dirs.mods);
    for (const jar of jars) files.push({ entry: jar.entry, target: jar.target });

    // Unpacked folders: refetched only when their source zip changed (CRC), or the folder is gone.
    const extractedCrc: Record<string, number> = {};
    // Shader settings: the player's edits are kept (ShaderPolicy decides).
    const settings: DeltaFile[] = [];
    const folderKey = (folder: string): string => path.relative(gameDir, folder).replace(/\\/g, '/');
    const groupFiles = (manifest: OptionalManifest, dir: string, prefix: string): void => {
      for (const item of manifest.entries) {
        const entry = assets.get(prefix + item.name);
        if (!entry) throw new Error(`Asset manquant dans assets.zip: ${item.name}`);
        if (!item.extract) {
          const target = ModpackSync.safeJoin(dir, item.name);
          if (this.isShaderSettings(dir, item.name)) {
            settings.push({ entry, target });
            continue;
          }
          files.push({ entry, target });
          continue;
        }
        const folder = ModpackSync.safeJoin(dir, ModpackSync.folderNameFor(item.name));
        const key = folderKey(folder);
        extractedCrc[key] = entry.crc;
        if (cache.extractedCrc?.[key] === entry.crc && ModpackSync.dirExists(folder)) continue;
        files.push({ entry, target: folder, always: true, unpack: true });
      }
    };
    groupFiles(resourcePacks, dirs.resourcepacks, 'resourcepacks/');
    groupFiles(shaderPacks, dirs.shaderpacks, 'shaderpacks/');
    this.shaders.setRevision(clientOptions?.shaderRevision ?? 0);
    for (const file of settings) {
      if (!(await this.shaders.keepSettings(file.target, file.entry.crc))) files.push({ ...file, always: true });
    }
    const overridesArchive = path.join(gameDir, OVERRIDES_ARCHIVE);
    if (overrides.present) {
      const entry = assets.get(overrides.name);
      if (!entry) throw new Error(`Asset manquant dans assets.zip: ${overrides.name}`);
      files.push({ entry, target: overridesArchive });
    }

    const modsPlan = await planDelta(modsZip, files.filter((f) => modsZip.entries.includes(f.entry)), verifier);
    const assetsPlan = await planDelta(assetsZip, files.filter((f) => !modsZip.entries.includes(f.entry)), verifier);
    const total = modsPlan.bytes + assetsPlan.bytes;
    const count = modsPlan.needed.length + assetsPlan.needed.length;
    onStatus(
      count === 0
        ? 'Tous les fichiers du pack sont déjà installés.'
        : `${count} fichier(s) à mettre à jour, ${formatBytes(total)} à télécharger ` +
            `(${formatBytes(modsPlan.keptBytes + assetsPlan.keptBytes)} déjà installés).`,
    );

    // Folders extracted from a pack zip: the zip goes to a temp file, then is unpacked.
    const unpack = new Map<DeltaFile, string>();
    for (const file of assetsPlan.needed) {
      if (!file.unpack) continue;
      const tmp = ModpackSync.safeJoin(
        path.dirname(file.target),
        `.karamon-extract-${process.pid}-${Date.now()}-${path.basename(file.target)}.zip`,
      );
      unpack.set(file, file.target);
      file.target = tmp;
    }
    let modsBytes = 0;
    let assetsBytes = 0;
    const report = (): void => onProgress(0.08 + 0.85 * (total > 0 ? (modsBytes + assetsBytes) / total : 1));
    const overridesChanged = assetsPlan.needed.some((f) => f.target === overridesArchive);
    try {
      await Promise.all([
        fetchDelta(modsZip, modsPlan, verifier, (p) => {
          modsBytes = p * modsPlan.bytes;
          report();
        }, (f) => onStatus(`+ ${path.basename(f.target)}`)),
        fetchDelta(assetsZip, assetsPlan, verifier, (p) => {
          assetsBytes = p * assetsPlan.bytes;
          report();
        }, (f) => {
          if (!unpack.has(f)) onStatus(`+ ${path.basename(f.target)}`);
        }),
      ]);
      for (const [file, folder] of unpack) {
        fs.rmSync(folder, { recursive: true, force: true });
        await extractZipToDir(file.target, folder, { stripCommonTopLevelFolder: true, durable: true });
        onStatus(`+ ${path.basename(folder)}/`);
      }
    } finally {
      for (const file of unpack.keys()) fs.rmSync(file.target, { force: true });
    }

    const jarNames = jars.filter((j) => !j.disabled).map((j) => j.name);
    this.cleanupExtras(dirs.mods, jarNames, '.jar', onStatus, 'Mod supprimé');
    this.cleanupPackFiles(dirs.resourcepacks, resourcePacks.entries, onStatus, 'Resource pack supprimé');
    this.cleanupOrphanedFolders(
      dirs.resourcepacks,
      cache.resourcePackFolders,
      ModpackSync.extractedFolders(resourcePacks.entries),
      onStatus,
      'Resource pack supprimé',
    );
    this.cleanupPackFiles(dirs.shaderpacks, shaderPacks.entries, onStatus, 'Shader pack supprimé');
    this.cleanupOrphanedFolders(
      dirs.shaderpacks,
      cache.shaderPackFolders,
      ModpackSync.extractedFolders(shaderPacks.entries),
      onStatus,
      'Shader pack supprimé',
    );

    let overridesSummary = '';
    if (overrides.present && (overridesChanged || cache.overridesKey !== overrides.key || !ctx.assetsUpToDate)) {
      onStatus('Installation des configs du pack...');
      const result = installOverrides(overridesArchive, gameDir);
      overridesSummary = `, ${result.written} fichier(s) de config`;
      onStatus(`Configs du pack: ${result.written} écrit(s), ${result.kept} conservé(s).`);
    }
    this.storeClientOptions(gameDir, clientOptions);

    const jarManifest = modsManifest.present ? modsManifest.entries : undefined;
    const still = await this.damagedJars(dirs.mods, jarNames, jarManifest, verifier);
    if (still.length > 0) {
      throw new Error(`${still.join(', ')} ne correspond(ent) pas au manifeste du pack`);
    }

    const installed: AssetsSnapshot = {
      resourcePacks: resourcePacks.entries,
      shaderPacks: shaderPacks.entries,
      overridesPresent: overrides.present,
      overridesKey: overrides.key,
      overridesSize: overrides.present ? overrides.size : undefined,
      overridesSha1: overrides.sha1,
    };
    this.writeCache(gameDir, {
      modsEtag,
      jarNames,
      modsManifest: jarManifest,
      assetsKey,
      assetsSnapshot: installed,
      resourcePacksKey: ModpackSync.hashEntries(resourcePacks.entries),
      resourcePackFolders: ModpackSync.extractedFolders(resourcePacks.entries),
      shaderPacksKey: ModpackSync.hashEntries(shaderPacks.entries),
      shaderPackFolders: ModpackSync.extractedFolders(shaderPacks.entries),
      overridesKey: overrides.key,
      extractedCrc,
      syncedAt: Date.now(),
    });
    onProgress(0.98);
    onStatus(
      `Pack synchronisé: ${jarNames.length} mods, ${resourcePacks.entries.length} resource packs, ` +
        `${shaderPacks.entries.length} shaders${overridesSummary} (${formatBytes(total)} téléchargés).`,
    );
    onProgress(1);
    return { clientOptions };
  }

  /** Name of an entry of a zip whose entries all sit in one top folder, without that folder. */
  private static stripTop(entries: ZipEntry[], name: string): string {
    const prefix = commonTopLevelPrefix(entries);
    return prefix ? name.slice(prefix.length) : name;
  }

  private async assetsIntact(
    dirs: SyncDirs,
    gameDir: string,
    snapshot: AssetsSnapshot,
    verifier: FileVerifier,
  ): Promise<boolean> {
    if (!(await this.allEntriesIntact(dirs.resourcepacks, snapshot.resourcePacks, verifier))) return false;
    if (!(await this.allEntriesIntact(dirs.shaderpacks, snapshot.shaderPacks, verifier))) return false;
    if (snapshot.overridesPresent) {
      if (!ModpackSync.dirExists(path.join(gameDir, 'config'))) return false;
      const expected: ExpectedFile = { size: snapshot.overridesSize, sha1: snapshot.overridesSha1 };
      if (!(await verifier.isIntact(path.join(gameDir, OVERRIDES_ARCHIVE), expected))) return false;
    }
    return true;
  }

  private async installAssetsFromZip(
    zipPath: string,
    gameDir: string,
    dirs: SyncDirs,
    cache: CacheData,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
  ): Promise<{
    snapshot: AssetsSnapshot;
    modsManifest: ManifestEntry[] | undefined;
    clientOptions: ClientOptions | null;
    overridesSummary: string;
  }> {
    const extractDir = path.join(gameDir, ASSETS_EXTRACT_DIR);
    try {
      onStatus('Extraction des assets...');
      fs.rmSync(extractDir, { recursive: true, force: true });
      await extractZipToDir(zipPath, extractDir, { stripCommonTopLevelFolder: true });

      const resourcePacks = this.readOptionalManifestFile(path.join(extractDir, RESOURCE_PACKS_MANIFEST));
      const shaderPacks = this.readOptionalManifestFile(path.join(extractDir, SHADER_PACKS_MANIFEST));
      const modsManifest = this.readOptionalManifestFile(path.join(extractDir, MODS_MANIFEST));
      const overrides = this.readOverridesManifestFile(path.join(extractDir, OVERRIDES_MANIFEST));
      const clientOptions = this.readClientOptionsFile(path.join(extractDir, CLIENT_OPTIONS_NAME));
      this.storeClientOptions(gameDir, clientOptions);
      this.shaders.setRevision(clientOptions?.shaderRevision ?? 0);

      if (resourcePacks.present) {
        await this.installManifestGroupFromDir(
          resourcePacks,
          dirs.resourcepacks,
          path.join(extractDir, 'resourcepacks'),
          'resource packs',
          'Resource pack supprimé',
          cache.resourcePackFolders,
          cache.resourcePacksKey !== resourcePacks.key,
          verifier,
          onStatus,
        );
      }
      if (shaderPacks.present) {
        await this.installManifestGroupFromDir(
          shaderPacks,
          dirs.shaderpacks,
          path.join(extractDir, 'shaderpacks'),
          'shader packs',
          'Shader pack supprimé',
          cache.shaderPackFolders,
          cache.shaderPacksKey !== shaderPacks.key,
          verifier,
          onStatus,
        );
      }

      let overridesSummary = '';
      if (overrides.present) {
        onStatus('Installation des configs du pack...');
        const archive = path.join(gameDir, OVERRIDES_ARCHIVE);
        copyFileAtomic(ModpackSync.safeJoin(extractDir, overrides.name), archive);
        const result = installOverrides(archive, gameDir);
        overridesSummary = `, ${result.written} fichier(s) de config`;
        onStatus(`Configs du pack: ${result.written} écrit(s), ${result.kept} conservé(s).`);
      }

      return {
        snapshot: {
          resourcePacks: resourcePacks.entries,
          shaderPacks: shaderPacks.entries,
          overridesPresent: overrides.present,
          overridesKey: overrides.key,
          overridesSize: overrides.present ? overrides.size : undefined,
          overridesSha1: overrides.sha1,
        },
        modsManifest: modsManifest.present ? modsManifest.entries : undefined,
        clientOptions,
        overridesSummary,
      };
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }

  private readOptionalManifestFile(filePath: string): OptionalManifest {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      return {
        present: true,
        key: ModpackSync.hashText(text),
        entries: ModpackSync.parseManifest(text, path.basename(filePath)),
      };
    } catch {
      return { present: false, key: '', entries: [] };
    }
  }

  private readOverridesManifestFile(filePath: string): OverridesManifest {
    try {
      return ModpackSync.parseOverridesManifest(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return ModpackSync.absentOverrides();
    }
  }

  private static parseOverridesManifest(text: string): OverridesManifest {
    const raw = JSON.parse(text) as { name?: unknown; size?: unknown; sha1?: unknown };
    if (typeof raw?.name !== 'string' || typeof raw?.size !== 'number' || raw.size <= 0) {
      return ModpackSync.absentOverrides();
    }
    const manifest: OverridesManifest = {
      present: true,
      key: ModpackSync.hashText(text),
      name: raw.name,
      size: raw.size,
    };
    const sha1 = ModpackSync.parseSha1(raw.sha1);
    if (sha1) manifest.sha1 = sha1;
    return manifest;
  }

  private static absentOverrides(): OverridesManifest {
    return { present: false, key: '', name: '', size: 0 };
  }

  private static parseSha1(value: unknown): string | undefined {
    return typeof value === 'string' && SHA1_HEX.test(value) ? value.toLowerCase() : undefined;
  }

  private readClientOptionsFile(filePath: string): ClientOptions | null {
    try {
      return parseClientOptions(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
      return this.fallbackClientOptions;
    }
  }

  private async installManifestGroupFromDir(
    manifest: OptionalManifest,
    destDir: string,
    sourceDir: string,
    statusLabel: string,
    cleanupLabel: string,
    previousFolders: string[] | undefined,
    forceReExtract: boolean,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
  ): Promise<void> {
    if (manifest.entries.length > 0) {
      onStatus(`Installation de ${manifest.entries.length} ${statusLabel}...`);
    }
    for (const entry of manifest.entries) {
      if (entry.extract) {
        await this.installAndExtractFromDir(entry, destDir, sourceDir, forceReExtract, onStatus);
      } else {
        await this.installFileFromDir(entry, destDir, sourceDir, verifier, onStatus);
      }
    }
    this.cleanupPackFiles(destDir, manifest.entries, onStatus, cleanupLabel);
    this.cleanupOrphanedFolders(
      destDir,
      previousFolders,
      ModpackSync.extractedFolders(manifest.entries),
      onStatus,
      cleanupLabel,
    );
  }

  private async installFileFromDir(
    entry: ManifestEntry,
    destDir: string,
    sourceDir: string,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
  ): Promise<void> {
    const target = ModpackSync.safeJoin(destDir, entry.name);
    const src = ModpackSync.safeJoin(sourceDir, entry.name);
    if (this.isShaderSettings(destDir, entry.name)) {
      const packCrc = fs.existsSync(src) ? await crc32File(src) : null;
      if (await this.shaders.keepSettings(target, packCrc)) return;
    } else if (await verifier.isIntact(target, entry)) return;
    if (!fs.existsSync(src)) {
      throw new Error(`Asset manquant dans assets.zip: ${entry.name}`);
    }
    copyFileAtomic(src, target);
    onStatus(`+ ${entry.name}`);
  }

  /** shaderpacks/*.txt: the per-shader settings the player edits in game. */
  private isShaderSettings(destDir: string, name: string): boolean {
    return path.basename(destDir) === 'shaderpacks' && ShaderPolicy.isSettingsFile(name);
  }

  private async installAndExtractFromDir(
    entry: ManifestEntry,
    destDir: string,
    sourceDir: string,
    forceReExtract: boolean,
    onStatus: StatusEmitter,
  ): Promise<void> {
    const folderName = ModpackSync.folderNameFor(entry.name);
    const folderPath = ModpackSync.safeJoin(destDir, folderName);
    if (!forceReExtract && ModpackSync.dirExists(folderPath)) return;
    const src = ModpackSync.safeJoin(sourceDir, entry.name);
    if (!fs.existsSync(src)) {
      throw new Error(`Asset manquant dans assets.zip: ${entry.name}`);
    }
    fs.rmSync(folderPath, { recursive: true, force: true });
    await extractZipToDir(src, folderPath, { stripCommonTopLevelFolder: true, durable: true });
    onStatus(`+ ${folderName}/`);
  }

  private static hashEntries(entries: ManifestEntry[]): string {
    return ModpackSync.hashText(JSON.stringify(entries));
  }

  private async fetchOptionalManifest(baseUrl: string, manifestName: string): Promise<OptionalManifest> {
    try {
      const text = await this.http.getText(baseUrl + manifestName);
      return {
        present: true,
        key: ModpackSync.hashText(text),
        entries: ModpackSync.parseManifest(text, manifestName),
      };
    } catch {
      return { present: false, key: '', entries: [] };
    }
  }

  private static parseManifest(text: string, label: string): ManifestEntry[] {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`Manifest ${label} illisible: ${(e as Error).message}`);
    }
    if (!Array.isArray(raw)) throw new Error(`Manifest ${label} invalide (attendu: tableau)`);
    return raw
      .filter((e): e is ManifestEntry =>
        !!e &&
        typeof (e as ManifestEntry).name === 'string' &&
        typeof (e as ManifestEntry).size === 'number',
      )
      .map((e) => {
        const entry: ManifestEntry = { name: e.name, size: e.size };
        const sha1 = ModpackSync.parseSha1((e as { sha1?: unknown }).sha1);
        if (sha1) entry.sha1 = sha1;
        if ((e as { extract?: unknown }).extract === true) entry.extract = true;
        return entry;
      });
  }

  private static folderNameFor(zipName: string): string {
    return zipName.replace(/\.zip$/i, '');
  }

  private static extractedFolders(entries: ManifestEntry[]): string[] {
    return entries.filter((e) => e.extract).map((e) => ModpackSync.folderNameFor(e.name));
  }

  private static hashText(text: string): string {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  private static lowerSet(names: string[]): Set<string> {
    return new Set(names.map((n) => n.toLowerCase()));
  }

  private async manifestGroupUpToDate(
    cachedKey: string | undefined,
    manifest: OptionalManifest,
    dir: string,
    verifier: FileVerifier,
  ): Promise<boolean> {
    if (!manifest.present) return true;
    return cachedKey === manifest.key && (await this.allEntriesIntact(dir, manifest.entries, verifier));
  }

  /**
   * Loose files: size, zip end record and SHA-1 when published. Extracted
   * packs (`extract: true`) can't be hashed once unpacked: their folder must exist.
   * Shader settings files (shaderpacks/*.txt) only need to exist: the player
   * edits them in game, and a different content is their choice, not damage.
   */
  private async allEntriesIntact(dir: string, entries: ManifestEntry[], verifier: FileVerifier): Promise<boolean> {
    let intact = true;
    const settingsDir = path.basename(dir) === 'shaderpacks';
    for (const entry of entries) {
      if (entry.extract) {
        if (!ModpackSync.dirExists(path.join(dir, ModpackSync.folderNameFor(entry.name)))) intact = false;
      } else if (settingsDir && ShaderPolicy.isSettingsFile(entry.name)) {
        if (!fs.existsSync(path.join(dir, entry.name))) intact = false;
      } else if (!(await verifier.isIntact(path.join(dir, entry.name), entry))) {
        intact = false;
      }
    }
    return intact;
  }

  private static dirExists(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private async syncManifestGroup(
    manifest: OptionalManifest,
    destDir: string,
    baseUrl: string,
    urlPrefix: string,
    statusLabel: string,
    cleanupLabel: string,
    previousFolders: string[] | undefined,
    forceReExtract: boolean,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
    progressStart: number,
    progressSpan: number,
  ): Promise<void> {
    if (manifest.entries.length > 0) {
      onStatus(`Téléchargement de ${manifest.entries.length} ${statusLabel}...`);
      await this.downloadAll(
        manifest.entries,
        destDir,
        baseUrl,
        urlPrefix,
        forceReExtract,
        verifier,
        onStatus,
        onProgress,
        progressStart,
        progressSpan,
      );
    } else {
      onProgress(progressStart + progressSpan);
    }

    this.cleanupPackFiles(destDir, manifest.entries, onStatus, cleanupLabel);

    this.cleanupOrphanedFolders(
      destDir,
      previousFolders,
      ModpackSync.extractedFolders(manifest.entries),
      onStatus,
      cleanupLabel,
    );
  }

  private async downloadAll(
    entries: ManifestEntry[],
    destDir: string,
    baseUrl: string,
    urlPrefix: string,
    forceReExtract: boolean,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
    onProgress: ProgressEmitter,
    progressStart: number,
    progressSpan: number,
  ): Promise<void> {
    if (entries.length === 0) return;

    const queue = [...entries];
    let done = 0;
    const failures: string[] = [];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) return;
        try {
          if (entry.extract) {
            await this.downloadAndExtract(entry, destDir, baseUrl, urlPrefix, forceReExtract, onStatus);
          } else {
            await this.downloadFile(entry, destDir, baseUrl, urlPrefix, verifier, onStatus);
          }
        } catch (e) {
          failures.push(entry.name);
          onStatus(`Échec ${entry.name}: ${(e as Error).message}`);
        }
        done++;
        onProgress(progressStart + progressSpan * (done / entries.length));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_DOWNLOADS, entries.length) }, () => worker()),
    );

    if (failures.length > 0) {
      throw new Error(`${failures.length} téléchargement(s) échoué(s): ${failures.join(', ')}`);
    }
  }

  private async downloadFile(
    entry: ManifestEntry,
    destDir: string,
    baseUrl: string,
    urlPrefix: string,
    verifier: FileVerifier,
    onStatus: StatusEmitter,
  ): Promise<void> {
    const target = ModpackSync.safeJoin(destDir, entry.name);
    if (this.isShaderSettings(destDir, entry.name)) {
      // No pack version to compare with before downloading: the player's file wins.
      if (await this.shaders.keepSettings(target, null)) return;
    } else if (await verifier.isIntact(target, entry)) return;
    const url = packAssetUrl(baseUrl, entry.name, urlPrefix);
    await this.http.download(url, target, { label: entry.name, expectedSha1: entry.sha1 });
    onStatus(`+ ${entry.name}`);
  }

  private async downloadAndExtract(
    entry: ManifestEntry,
    destDir: string,
    baseUrl: string,
    urlPrefix: string,
    forceReExtract: boolean,
    onStatus: StatusEmitter,
  ): Promise<void> {
    const folderName = ModpackSync.folderNameFor(entry.name);
    const folderPath = ModpackSync.safeJoin(destDir, folderName);
    if (!forceReExtract && ModpackSync.dirExists(folderPath)) return;
    const url = packAssetUrl(baseUrl, entry.name, urlPrefix);
    const tmpZip = ModpackSync.safeJoin(
      destDir,
      `.karamon-extract-${process.pid}-${Date.now()}-${path.basename(folderName)}.zip`,
    );
    try {
      await this.http.download(url, tmpZip, { label: entry.name, expectedSha1: entry.sha1 });
      fs.rmSync(folderPath, { recursive: true, force: true });
      await extractZipToDir(tmpZip, folderPath, { stripCommonTopLevelFolder: true, durable: true });
      onStatus(`+ ${folderName}/`);
    } finally {
      fs.rmSync(tmpZip, { force: true });
    }
  }

  private cleanupOrphanedFolders(
    dir: string,
    previousFolders: string[] | undefined,
    currentFolders: string[],
    onStatus: StatusEmitter,
    label: string,
  ): void {
    if (!previousFolders || previousFolders.length === 0) return;
    const keepLc = new Set(currentFolders.map((n) => n.toLowerCase()));
    for (const folderName of previousFolders) {
      if (keepLc.has(folderName.toLowerCase())) continue;
      let folderPath: string;
      try {
        folderPath = ModpackSync.safeJoin(dir, folderName);
      } catch {
        continue;
      }
      if (!ModpackSync.dirExists(folderPath)) continue;
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        onStatus(`${label}: ${folderName}/`);
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Removes the loose files (zips, shader settings) that an earlier pack
   * version installed in `dir` and the current one no longer ships. Files the
   * pack never installed (a shader or resource pack the player added) stay.
   */
  private cleanupPackFiles(dir: string, entries: ManifestEntry[], onStatus: StatusEmitter, label: string): void {
    const group = path.basename(dir) === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
    const current = entries.filter((e) => !e.extract).map((e) => e.name);
    const currentLc = new Set(current.map((n) => n.toLowerCase()));
    const previous = this.shipped[group];
    // First sync with this launcher: no record yet, nothing is known to be ours.
    for (const name of previous ?? []) {
      if (currentLc.has(name.toLowerCase())) continue;
      let file: string;
      try {
        file = ModpackSync.safeJoin(dir, name);
      } catch {
        continue;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      fs.rmSync(file, { force: true });
      onStatus(`${label}: ${name}`);
    }
    this.shipped[group] = current;
  }

  private cleanupExtras(
    dir: string,
    keptNames: string[],
    ext: string,
    onStatus: StatusEmitter,
    label: string,
  ): void {
    const keptLc = new Set(keptNames.map((n) => n.toLowerCase()));
    for (const file of fs.readdirSync(dir)) {
      if (file.toLowerCase().endsWith(ext) && !keptLc.has(file.toLowerCase())) {
        fs.rmSync(path.join(dir, file), { force: true });
        onStatus(`${label}: ${file}`);
      }
    }
  }

  private readCache(gameDir: string): CacheData {
    try {
      return JSON.parse(fs.readFileSync(path.join(gameDir, CACHE_FILE), 'utf8')) as CacheData;
    } catch {
      return {};
    }
  }

  private writeCache(gameDir: string, data: CacheData): void {
    // Records shared by every sync path: kept even when a path does not set them.
    const previous = this.readCache(gameDir);
    const full: CacheData = {
      ...data,
      shippedFiles: this.shipped,
      extractedCrc: data.extractedCrc ?? previous.extractedCrc,
    };
    try {
      writeFileAtomic(path.join(gameDir, CACHE_FILE), JSON.stringify(full));
    } catch {
      /* best-effort cache */
    }
  }

  private static safeJoin(rootDir: string, relPath: string): string {
    return resolveInside(rootDir, relPath);
  }
}
