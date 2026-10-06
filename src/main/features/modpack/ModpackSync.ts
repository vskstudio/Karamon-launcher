import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { extractZipToDir, resolveInside } from '../../shared/ZipExtract.ts';
import { ZipReader } from '../../shared/ZipReader.ts';
import { copyFileAtomic, writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { githubAssetFreshness, packAssetUrl } from '../../shared/GitHubPack.ts';
import { OptionsWriter } from '../minecraft/OptionsWriter.ts';
import { applyKaramonBranding } from '../minecraft/BrandingWriter.ts';
import { parseClientOptions, type ClientOptions } from '../../shared/ClientOptions.ts';
import { installOverrides } from './OverridesInstaller.ts';
import { FileVerifier, sha1File, type ExpectedFile } from '../integrity/FileVerifier.ts';

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
}

export class ModpackSync {
  private readonly http: HttpClient;
  private readonly optionsWriterFactory: (dir: string) => OptionsWriter;
  private readonly disabledJarPrefixes: string[];
  private readonly fallbackClientOptions: ClientOptions | null;

  constructor({
    http,
    optionsWriterFactory,
    disabledJarPrefixes,
    fallbackClientOptions,
  }: ModpackSyncOptions) {
    this.http = http;
    this.optionsWriterFactory = optionsWriterFactory;
    this.disabledJarPrefixes = (disabledJarPrefixes ?? []).map((prefix) => prefix.toLowerCase());
    this.fallbackClientOptions = fallbackClientOptions ?? null;
  }

  /** The pack's overrides archive as last installed, or null if none is kept. */
  static overridesArchive(gameDir: string): string | null {
    const file = path.join(gameDir, OVERRIDES_ARCHIVE);
    return fs.existsSync(file) ? file : null;
  }

  static listMods(gameDir: string): { name: string; size: number }[] {
    const dir = path.join(gameDir, 'mods');
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.jar'))
        .map((name) => {
          let size = 0;
          try {
            size = fs.statSync(path.join(dir, name)).size;
          } catch {
            /* ignore */
          }
          return { name, size };
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
    try {
      const assetsKey = await this.probeAssetsZip(base);
      if (assetsKey) {
        await this.syncWithAssetsZip(base, gameDir, dirs, etag, assetsKey, cache, verifier, onStatus, onProgress);
      } else {
        await this.syncLooseFiles(base, gameDir, dirs, etag, cache, verifier, onStatus, onProgress);
      }
    } finally {
      verifier.save();
    }
    return { damaged: verifier.damaged };
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

    const applyOptions = (): void => {
      const writer = this.optionsWriterFactory(gameDir);
      try {
        if (clientOptions) {
          writer.forceResourcePacks(clientOptions.resourcePacks);
          writer.ensureShader(clientOptions.shaderPack, clientOptions.enableShaders);
        }
        applyKaramonBranding(gameDir, clientOptions?.resourcePacks);
      } catch {
        /* non-fatal */
      }
    };

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
      const seen = new Set<string>();
      const jarNames: string[] = [];
      const disabledDir = path.join(modsDir, 'mods-disabled');
      for (const entry of zip.entries) {
        if (entry.isDirectory) continue;
        const name = path.basename(entry.entryName);
        const lower = name.toLowerCase();
        if (!lower.endsWith('.jar')) continue;
        if (seen.has(lower)) continue;
        seen.add(lower);
        if (this.isDisabledJar(name)) {
          if (only) continue;
          await zip.extractTo(entry, ModpackSync.safeJoin(disabledDir, name), { durable: true });
          onStatus(`Mod client désactivé (Java 21): ${name}`);
          continue;
        }
        jarNames.push(name);
        if (only && !only.has(lower)) continue;
        await zip.extractTo(entry, ModpackSync.safeJoin(modsDir, name), { durable: true });
        if (only) onStatus(`Mod réparé: ${name}`);
      }
      if (jarNames.length === 0) {
        throw new Error('mods.zip ne contient aucun .jar');
      }
      return jarNames;
    });
  }

  /**
   * Enabled jars that are missing or damaged. Jars moved to mods-disabled are
   * listed by the manifest too but are never loaded, so they are skipped.
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
      if (!(await verifier.isIntact(path.join(modsDir, name), entry ?? {}))) damaged.push(name);
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

    const applyOptions = (options: ClientOptions | null): void => {
      const writer = this.optionsWriterFactory(gameDir);
      try {
        if (options) {
          writer.forceResourcePacks(options.resourcePacks);
          writer.ensureShader(options.shaderPack, options.enableShaders);
        }
        applyKaramonBranding(gameDir, options?.resourcePacks);
      } catch {
        /* non-fatal */
      }
    };

    if (modsUpToDate && assetsUpToDate) {
      applyOptions(this.loadStoredClientOptions(gameDir));
      onStatus('Pack déjà à jour, aucun téléchargement nécessaire.');
      onProgress(1);
      return;
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
    this.cleanupExtras(
      destDir,
      manifest.entries.filter((e) => !e.extract).map((e) => e.name),
      '.zip',
      onStatus,
      cleanupLabel,
    );
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
    if (await verifier.isIntact(target, entry)) return;
    const src = ModpackSync.safeJoin(sourceDir, entry.name);
    if (!fs.existsSync(src)) {
      throw new Error(`Asset manquant dans assets.zip: ${entry.name}`);
    }
    copyFileAtomic(src, target);
    onStatus(`+ ${entry.name}`);
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
   */
  private async allEntriesIntact(dir: string, entries: ManifestEntry[], verifier: FileVerifier): Promise<boolean> {
    let intact = true;
    for (const entry of entries) {
      if (entry.extract) {
        if (!ModpackSync.dirExists(path.join(dir, ModpackSync.folderNameFor(entry.name)))) intact = false;
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

    this.cleanupExtras(
      destDir,
      manifest.entries.filter((e) => !e.extract).map((e) => e.name),
      '.zip',
      onStatus,
      cleanupLabel,
    );

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
    if (await verifier.isIntact(target, entry)) return;
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
    try {
      writeFileAtomic(path.join(gameDir, CACHE_FILE), JSON.stringify(data));
    } catch {
      /* best-effort cache */
    }
  }

  private static safeJoin(rootDir: string, relPath: string): string {
    return resolveInside(rootDir, relPath);
  }
}
