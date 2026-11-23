import fs from 'fs';
import { commonTopLevelPrefix } from '../../shared/ZipExtract.ts';
import { ZipReader, type ZipEntry } from '../../shared/ZipReader.ts';
import { RemoteZip } from '../../shared/RemoteZip.ts';
import { RangeUnsupportedError, type HttpClient } from '../../shared/HttpClient.ts';
import { packAssetUrl } from '../../shared/GitHubPack.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import {
  ASSETS_ZIP,
  MODS_ZIP,
  readPackDescription,
  type AssetGroup,
  type PackDescription,
} from './PackDescription.ts';

const ARCHIVE_DOWNLOAD_IDLE_TIMEOUT_MS = 1200000;
const PARALLEL_LOOSE_DOWNLOADS = 8;
const PARALLEL_RANGED_READS = 4;

export type ArchiveName = 'mods' | 'assets';

export type FileSource =
  | { kind: 'entry'; archive: ArchiveName; entry: ZipEntry }
  | { kind: 'url'; name: string; prefix: string; sha1?: string };

export interface FetchItem {
  source: FileSource;
  target: string;
  onFetched?: () => void;
}

export interface SourceNeeds {
  mods: boolean;
  assets: boolean;
  damagedJars: number;
}

export type Progress = (fraction: number) => void;
export type Status = (message: string) => void;

export interface PackSource {
  prepare(needs: SourceNeeds, onProgress: Progress): Promise<void>;
  describe(cached: PackDescription | null): Promise<PackDescription>;
  modEntries(): Promise<ZipEntry[]>;
  assetFile(group: AssetGroup | null, entry: { name: string; sha1?: string }): Promise<FileSource>;
  bytesFor(items: FetchItem[]): number | null;
  fetch(items: FetchItem[], onProgress: Progress): Promise<void>;
  close(): void;
}

export class MissingAssetError extends Error {
  constructor(name: string) {
    super(`Asset manquant dans assets.zip: ${name}`);
    this.name = 'MissingAssetError';
  }
}

interface EntryArchive {
  entries: ZipEntry[];
  byName: Map<string, ZipEntry>;
}

function indexArchive(entries: ZipEntry[]): EntryArchive {
  const prefix = commonTopLevelPrefix(entries);
  const byName = new Map<string, ZipEntry>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    byName.set(prefix ? entry.entryName.slice(prefix.length) : entry.entryName, entry);
  }
  return { entries, byName };
}

function entrySource(archive: EntryArchive, path: string): FileSource {
  const entry = archive.byName.get(path);
  if (!entry) throw new MissingAssetError(path.slice(path.lastIndexOf('/') + 1));
  return { kind: 'entry', archive: 'assets', entry };
}

function assetPath(group: AssetGroup | null, name: string): string {
  return group ? group.pathPrefix + name : name;
}

async function inParallel<T>(items: T[], workers: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  };
  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, () => worker()));
}

export class RangedSource implements PackSource {
  private readonly instance: GameInstance;
  private readonly mods: RemoteZip;
  private readonly assets: RemoteZip;
  private readonly assetIndex: EntryArchive;

  private constructor(instance: GameInstance, mods: RemoteZip, assets: RemoteZip) {
    this.instance = instance;
    this.mods = mods;
    this.assets = assets;
    this.assetIndex = indexArchive(assets.entries);
  }

  static async open(
    http: HttpClient,
    baseUrl: string,
    instance: GameInstance,
    keys: { mods: string; assets: string },
  ): Promise<RangedSource | { failure: string | null }> {
    let mods: RemoteZip;
    let assets: RemoteZip;
    try {
      [mods, assets] = await Promise.all([
        RemoteZip.open(http, baseUrl + MODS_ZIP),
        RemoteZip.open(http, baseUrl + ASSETS_ZIP),
      ]);
    } catch (e) {
      return { failure: e instanceof RangeUnsupportedError ? null : (e as Error).message };
    }
    if (mods.etag !== keys.mods || assets.etag !== keys.assets) return { failure: null };
    return new RangedSource(instance, mods, assets);
  }

  async prepare(): Promise<void> {}

  async describe(cached: PackDescription | null): Promise<PackDescription> {
    if (cached) return cached;
    return readPackDescription(async (name) => {
      const entry = this.assetIndex.byName.get(name);
      if (!entry) return null;
      const tmp = this.instance.tempFile(name);
      try {
        await this.assets.extractTo(entry, tmp);
        return fs.readFileSync(tmp, 'utf8');
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    });
  }

  async modEntries(): Promise<ZipEntry[]> {
    return this.mods.entries;
  }

  async assetFile(group: AssetGroup | null, entry: { name: string }): Promise<FileSource> {
    return entrySource(this.assetIndex, assetPath(group, entry.name));
  }

  bytesFor(items: FetchItem[]): number {
    return this.split(items).reduce((sum, [zip, part]) => sum + zip.bytesFor(part.map((i) => entryOf(i))), 0);
  }

  async fetch(items: FetchItem[], onProgress: Progress): Promise<void> {
    const total = this.bytesFor(items);
    let received = 0;
    const onBytes = (n: number): void => {
      received += n;
      onProgress(total > 0 ? Math.min(1, received / total) : 1);
    };
    await Promise.all(
      this.split(items).map(([zip, part]) => {
        const biggestFirst = [...part].sort((a, b) => entryOf(b).compressedSize - entryOf(a).compressedSize);
        return inParallel(biggestFirst, PARALLEL_RANGED_READS, async (item) => {
          await zip.extractTo(entryOf(item), item.target, { durable: true, onBytes });
          item.onFetched?.();
        });
      }),
    );
    onProgress(1);
  }

  close(): void {}

  private split(items: FetchItem[]): [RemoteZip, FetchItem[]][] {
    const fromMods = items.filter((i) => i.source.kind === 'entry' && i.source.archive === 'mods');
    const fromAssets = items.filter((i) => !fromMods.includes(i));
    return [
      [this.mods, fromMods],
      [this.assets, fromAssets],
    ];
  }
}

function entryOf(item: FetchItem): ZipEntry {
  if (item.source.kind !== 'entry') throw new TypeError('source sans entrée de zip');
  return item.source.entry;
}

class DownloadedArchive {
  readonly file: string;
  private reader: ZipReader | null = null;
  private index: EntryArchive | null = null;

  constructor(file: string) {
    this.file = file;
  }

  open(): EntryArchive {
    this.reader ??= ZipReader.open(this.file);
    this.index ??= indexArchive(this.reader.entries);
    return this.index;
  }

  read(entry: ZipEntry): Buffer {
    return this.reader!.read(entry);
  }

  extractTo(entry: ZipEntry, target: string): Promise<void> {
    return this.reader!.extractTo(entry, target, { durable: true });
  }

  close(): void {
    this.reader?.close();
    this.reader = null;
    fs.rmSync(this.file, { force: true });
  }
}

export class DownloadedSource implements PackSource {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly onStatus: Status;
  private readonly archives: Record<ArchiveName, DownloadedArchive>;
  private readonly downloads = new Map<ArchiveName, Promise<EntryArchive>>();

  constructor(http: HttpClient, baseUrl: string, instance: GameInstance, onStatus: Status) {
    this.http = http;
    this.baseUrl = baseUrl;
    this.onStatus = onStatus;
    this.archives = {
      mods: new DownloadedArchive(instance.tempFile(MODS_ZIP)),
      assets: new DownloadedArchive(instance.tempFile(ASSETS_ZIP)),
    };
  }

  async prepare(needs: SourceNeeds, onProgress: Progress): Promise<void> {
    const wanted = (['mods', 'assets'] as const).filter((name) => needs[name]);
    if (wanted.length === 0) return;
    if (needs.damagedJars > 0) {
      this.onStatus(`${needs.damagedJars} mod(s) abîmé(s) ou manquant(s), retéléchargement de mods.zip...`);
    } else {
      this.onStatus(`Téléchargement de ${wanted.map(archiveFileName).join(' et ')}...`);
    }
    const fractions = new Map<ArchiveName, number>(wanted.map((name) => [name, 0]));
    const report = (): void => onProgress([...fractions.values()].reduce((a, b) => a + b, 0) / wanted.length);
    await Promise.all(
      wanted.map((name) =>
        this.archive(name, (p) => {
          fractions.set(name, p);
          report();
        }),
      ),
    );
  }

  async describe(cached: PackDescription | null): Promise<PackDescription> {
    if (cached) return cached;
    const index = await this.archive('assets');
    return readPackDescription(async (name) => {
      const entry = index.byName.get(name);
      return entry ? this.archives.assets.read(entry).toString('utf8') : null;
    });
  }

  async modEntries(): Promise<ZipEntry[]> {
    return (await this.archive('mods')).entries;
  }

  async assetFile(group: AssetGroup | null, entry: { name: string }): Promise<FileSource> {
    return entrySource(await this.archive('assets'), assetPath(group, entry.name));
  }

  bytesFor(): null {
    return null;
  }

  async fetch(items: FetchItem[], onProgress: Progress): Promise<void> {
    let done = 0;
    for (const item of items) {
      if (item.source.kind !== 'entry') throw new TypeError('source sans entrée de zip');
      await this.archives[item.source.archive].extractTo(item.source.entry, item.target);
      item.onFetched?.();
      onProgress(++done / items.length);
    }
  }

  close(): void {
    this.archives.mods.close();
    this.archives.assets.close();
  }

  private archive(name: ArchiveName, onProgress?: Progress): Promise<EntryArchive> {
    let download = this.downloads.get(name);
    if (!download) {
      const archive = this.archives[name];
      download = this.http
        .download(this.baseUrl + archiveFileName(name), archive.file, {
          label: archiveFileName(name),
          timeoutMs: ARCHIVE_DOWNLOAD_IDLE_TIMEOUT_MS,
          onProgress,
        })
        .then(() => archive.open());
      this.downloads.set(name, download);
    }
    return download;
  }
}

function archiveFileName(name: ArchiveName): string {
  return name === 'mods' ? MODS_ZIP : ASSETS_ZIP;
}

export class LooseSource implements PackSource {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly onStatus: Status;
  private readonly mods: DownloadedSource;

  constructor(http: HttpClient, baseUrl: string, instance: GameInstance, onStatus: Status) {
    this.http = http;
    this.baseUrl = baseUrl;
    this.onStatus = onStatus;
    this.mods = new DownloadedSource(http, baseUrl, instance, onStatus);
  }

  prepare(needs: SourceNeeds, onProgress: Progress): Promise<void> {
    return this.mods.prepare({ ...needs, assets: false }, onProgress);
  }

  async describe(): Promise<PackDescription> {
    return readPackDescription(async (name) => {
      const res = await this.http.get(this.baseUrl + name);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} pour ${name}`);
      return res.body.toString('utf8');
    });
  }

  modEntries(): Promise<ZipEntry[]> {
    return this.mods.modEntries();
  }

  async assetFile(group: AssetGroup | null, entry: { name: string; sha1?: string }): Promise<FileSource> {
    return { kind: 'url', name: entry.name, prefix: group?.pathPrefix ?? '', ...(entry.sha1 ? { sha1: entry.sha1 } : {}) };
  }

  bytesFor(): null {
    return null;
  }

  async fetch(items: FetchItem[], onProgress: Progress): Promise<void> {
    const fromArchive = items.filter((i) => i.source.kind === 'entry');
    const fromUrl = items.filter((i) => i.source.kind === 'url');
    const total = items.length;
    let done = 0;
    await this.mods.fetch(fromArchive, () => onProgress(++done / total));
    const failures: string[] = [];
    await inParallel(fromUrl, PARALLEL_LOOSE_DOWNLOADS, async (item) => {
      const source = item.source as Extract<FileSource, { kind: 'url' }>;
      try {
        await this.http.download(packAssetUrl(this.baseUrl, source.name, source.prefix), item.target, {
          label: source.name,
          ...(source.sha1 ? { expectedSha1: source.sha1 } : {}),
        });
        item.onFetched?.();
      } catch (e) {
        failures.push(source.name);
        this.onStatus(`Échec ${source.name}: ${(e as Error).message}`);
      }
      onProgress(++done / total);
    });
    if (failures.length > 0) {
      throw new Error(`${failures.length} téléchargement(s) échoué(s): ${failures.join(', ')}`);
    }
  }

  close(): void {
    this.mods.close();
  }
}
