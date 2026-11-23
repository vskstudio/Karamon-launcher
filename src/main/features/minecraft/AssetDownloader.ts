import fs from 'fs';
import path from 'path';
import type { HttpClient } from '../../shared/HttpClient.ts';
import type { MojangAssetIndex } from './VersionResolver.ts';
import { cachedJsonText, sha1Matches } from './CachedJson.ts';

const RESOURCES_BASE = 'https://resources.download.minecraft.net';
const CONCURRENCY = 16;

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

export class AssetDownloader {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async download(
    index: MojangAssetIndex,
    assetsDir: string,
    onProgress?: (fraction: number, label: string) => void,
  ): Promise<void> {
    const indexPath = path.join(assetsDir, 'indexes', `${index.id}.json`);
    const indexText = await cachedJsonText(
      indexPath,
      (json, text) => !!json.objects && typeof json.objects === 'object' && sha1Matches(text, index.sha1),
      async () => {
        const text = await this.http.getText(index.url);
        if (!sha1Matches(text, index.sha1)) throw new Error(`Index des assets ${index.id} : empreinte SHA-1 invalide`);
        return text;
      },
    );

    const parsed = JSON.parse(indexText) as AssetIndex;
    const hashes = [...new Set(Object.values(parsed.objects).map((info) => info.hash))];
    const objectsDir = path.join(assetsDir, 'objects');

    let done = 0;
    const total = hashes.length;
    const queue = hashes.slice();

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const hash = queue.shift();
        if (!hash) break;
        const sub = hash.substring(0, 2);
        const dest = path.join(objectsDir, sub, hash);
        if (!fs.existsSync(dest)) {
          const url = `${RESOURCES_BASE}/${sub}/${hash}`;
          await this.http.download(url, dest, { expectedSha1: hash });
        }
        done++;
        if (done % 25 === 0 || done === total) {
          onProgress?.(done / total, `Assets ${done}/${total}`);
        }
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    onProgress?.(1, 'Assets prêts');
  }
}
