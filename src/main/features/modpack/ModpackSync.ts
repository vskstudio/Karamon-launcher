import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { extractZipToDir, readEntryData, resolveInside } from '../../shared/ZipExtract';
import type { HttpClient } from '../../shared/HttpClient';
import { githubAssetFreshness, packAssetUrl } from '../../shared/GitHubPack';
import { OptionsWriter } from '../minecraft/OptionsWriter';
import { applyKaramonBranding } from '../minecraft/BrandingWriter';
import { parseClientOptions, type ClientOptions } from '../../shared/ClientOptions';
import { installOverrides } from './OverridesInstaller';

const CACHE_FILE = '.karamon-sync-cache.json';
const MODS_ZIP_NAME = 'mods.zip';
const MODS_ZIP_TMP = '.karamon-mods.zip';
const RESOURCE_PACKS_MANIFEST = 'resourcepacks-manifest.json';
const RESOURCE_PACKS_PATH_PREFIX = 'resourcepacks/';
const SHADER_PACKS_MANIFEST = 'shaderpacks-manifest.json';
const SHADER_PACKS_PATH_PREFIX = 'shaderpacks/';
// Cobbleverse instance overrides (config/, datapacks/) that Prism gets from the pack
// import. Published as one zip + manifest; absent manifest = nothing to install.
const OVERRIDES_MANIFEST = 'overrides-manifest.json';
const OVERRIDES_ZIP_TMP = '.karamon-overrides.zip';
const CLIENT_OPTIONS_NAME = 'client-options.json';
const PARALLEL_DOWNLOADS = 8;
const ZIP_DOWNLOAD_TIMEOUT_MS = 1200000;

export type StatusEmitter = (msg: string) => void;
export type ProgressEmitter = (fraction: number) => void;

interface ManifestEntry {
  name: string;
  size: number;
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
}

interface SyncDirs {
  mods: string;
  resourcepacks: string;
  shaderpacks: string;
}

interface CacheData {
  modsEtag?: string;
  jarNames?: string[];
  resourcePacksKey?: string;
  resourcePackFolders?: string[];
  shaderPacksKey?: string;
  shaderPackFolders?: string[];
  overridesKey?: string;
  syncedAt?: number;
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

  invalidateCache(gameDir: string): void {
    const cachePath = path.join(gameDir, CACHE_FILE);
    try {
      fs.rmSync(cachePath, { force: true });
    } catch {
      /* best-effort */
    }
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
  ): Promise<void> {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const dirs = this.ensureDirs(gameDir);
    const zipUrl = base + MODS_ZIP_NAME;

    onStatus('Vérification du pack...');
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

    const resourcePacks = await this.fetchOptionalManifest(base, RESOURCE_PACKS_MANIFEST);
    const shaderPacks = await this.fetchOptionalManifest(base, SHADER_PACKS_MANIFEST);
    const overrides = await this.fetchOverridesManifest(base);
    const clientOptions = await this.fetchClientOptions(base);
    const cache = this.readCache(gameDir);

    const modsUpToDate =
      cache.modsEtag === etag &&
      Array.isArray(cache.jarNames) &&
      cache.jarNames.length > 0 &&
      cache.jarNames.every((n) => fs.existsSync(path.join(dirs.mods, n)));
    const resourcePacksUpToDate = this.manifestGroupUpToDate(
      cache.resourcePacksKey,
      resourcePacks,
      dirs.resourcepacks,
    );
    const shaderPacksUpToDate = this.manifestGroupUpToDate(
      cache.shaderPacksKey,
      shaderPacks,
      dirs.shaderpacks,
    );
    const overridesUpToDate =
      !overrides.present ||
      (cache.overridesKey === overrides.key && ModpackSync.dirExists(path.join(gameDir, 'config')));

    const applyOptions = (): void => {
      const writer = this.optionsWriterFactory(gameDir);
      try {
        writer.ensureDistantGeneration(true);
        if (clientOptions) {
          writer.forceResourcePacks(clientOptions.resourcePacks);
          writer.ensureShader(clientOptions.shaderPack, clientOptions.enableShaders);
        }
        applyKaramonBranding(gameDir);
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
      onStatus('Téléchargement de mods.zip...');
      const zipPath = path.join(gameDir, MODS_ZIP_TMP);
      try {
        await this.http.download(zipUrl, zipPath, {
          label: MODS_ZIP_NAME,
          timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
          onProgress: (p) => onProgress(0.05 + p * 0.55),
        });

        onStatus('Extraction des mods...');
        onProgress(0.62);
        jarNames = this.extractJars(zipPath, dirs.mods, onStatus);
      } finally {
        fs.rmSync(zipPath, { force: true });
      }
      this.cleanupExtras(dirs.mods, jarNames, '.jar', onStatus, 'Mod supprimé');
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
      const text = await this.http.getText(baseUrl + OVERRIDES_MANIFEST);
      const raw = JSON.parse(text) as { name?: unknown; size?: unknown };
      if (typeof raw?.name !== 'string' || typeof raw?.size !== 'number' || raw.size <= 0) {
        return { present: false, key: '', name: '', size: 0 };
      }
      return { present: true, key: ModpackSync.hashText(text), name: raw.name, size: raw.size };
    } catch {
      return { present: false, key: '', name: '', size: 0 };
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
    const tmpZip = path.join(gameDir, OVERRIDES_ZIP_TMP);
    try {
      await this.http.download(packAssetUrl(baseUrl, manifest.name), tmpZip, {
        label: manifest.name,
        onProgress: (p) => onProgress(progressStart + progressSpan * p),
      });
      const actual = fs.statSync(tmpZip).size;
      if (actual !== manifest.size) {
        throw new Error(`${manifest.name}: taille ${actual} au lieu de ${manifest.size}`);
      }
      onStatus('Installation des configs du pack...');
      const result = installOverrides(tmpZip, gameDir);
      onStatus(`Configs du pack: ${result.written} écrit(s), ${result.kept} conservé(s).`);
      return result;
    } finally {
      fs.rmSync(tmpZip, { force: true });
    }
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

  private extractJars(zipPath: string, modsDir: string, onStatus: StatusEmitter): string[] {
    const zipBuffer = fs.readFileSync(zipPath);
    const zip = new AdmZip(zipBuffer);
    const seen = new Set<string>();
    const jarNames: string[] = [];
    const disabledDir = path.join(modsDir, 'mods-disabled');
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      if (!name.toLowerCase().endsWith('.jar')) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      if (this.isDisabledJar(name)) {
        fs.mkdirSync(disabledDir, { recursive: true });
        fs.writeFileSync(ModpackSync.safeJoin(disabledDir, name), readEntryData(zipBuffer, entry));
        onStatus(`Mod client désactivé (Java 21): ${name}`);
        continue;
      }
      const target = ModpackSync.safeJoin(modsDir, name);
      fs.writeFileSync(target, readEntryData(zipBuffer, entry));
      jarNames.push(name);
    }
    if (jarNames.length === 0) {
      throw new Error('mods.zip ne contient aucun .jar');
    }
    return jarNames;
  }

  private isDisabledJar(name: string): boolean {
    const lower = name.toLowerCase();
    return this.disabledJarPrefixes.some((prefix) => lower.startsWith(prefix));
  }

  private async fetchClientOptions(baseUrl: string): Promise<ClientOptions | null> {
    try {
      const text = await this.http.getText(baseUrl + CLIENT_OPTIONS_NAME);
      return parseClientOptions(JSON.parse(text)) ?? this.fallbackClientOptions;
    } catch {
      return this.fallbackClientOptions;
    }
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

  private manifestGroupUpToDate(
    cachedKey: string | undefined,
    manifest: OptionalManifest,
    dir: string,
  ): boolean {
    if (!manifest.present) return true;
    return cachedKey === manifest.key && this.allEntriesPresent(dir, manifest.entries);
  }

  private allEntriesPresent(dir: string, entries: ManifestEntry[]): boolean {
    for (const entry of entries) {
      if (entry.extract) {
        if (!ModpackSync.dirExists(path.join(dir, ModpackSync.folderNameFor(entry.name)))) {
          return false;
        }
      } else if (!ModpackSync.fileMatchesSize(path.join(dir, entry.name), entry.size)) {
        return false;
      }
    }
    return true;
  }

  private static fileMatchesSize(filePath: string, size: number): boolean {
    try {
      return fs.statSync(filePath).size === size;
    } catch {
      return false;
    }
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
            await this.downloadFile(entry, destDir, baseUrl, urlPrefix, onStatus);
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
    onStatus: StatusEmitter,
  ): Promise<void> {
    const target = ModpackSync.safeJoin(destDir, entry.name);
    if (ModpackSync.fileMatchesSize(target, entry.size)) return;
    const url = packAssetUrl(baseUrl, entry.name, urlPrefix);
    await this.http.download(url, target, { label: entry.name });
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
      await this.http.download(url, tmpZip, { label: entry.name });
      fs.rmSync(folderPath, { recursive: true, force: true });
      extractZipToDir(tmpZip, folderPath, { stripCommonTopLevelFolder: true });
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
      fs.writeFileSync(path.join(gameDir, CACHE_FILE), JSON.stringify(data), 'utf8');
    } catch {
      /* best-effort cache */
    }
  }

  private static safeJoin(rootDir: string, relPath: string): string {
    return resolveInside(rootDir, relPath);
  }
}
