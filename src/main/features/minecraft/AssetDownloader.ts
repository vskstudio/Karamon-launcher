import fs from 'fs';
import path from 'path';
import type { HttpClient } from '../../shared/HttpClient';
import type { MojangAssetIndex } from './VersionResolver';

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
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });

    let indexText: string;
    if (fs.existsSync(indexPath)) {
      indexText = fs.readFileSync(indexPath, 'utf8');
    } else {
      indexText = await this.http.getText(index.url);
      fs.writeFileSync(indexPath, indexText, 'utf8');
    }

    const parsed = JSON.parse(indexText) as AssetIndex;
    // Several names can share one object: two workers on the same hash race on its .tmp file.
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
