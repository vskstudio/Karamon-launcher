import type { HttpClient } from '../../shared/HttpClient.ts';
import { cachedJsonText, sha1Matches } from './CachedJson.ts';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

interface ManifestEntry {
  id: string;
  type: string;
  url: string;
  sha1: string;
}

interface Manifest {
  versions: ManifestEntry[];
}

export class VersionManifest {
  private readonly http: Pick<HttpClient, 'getJson' | 'getText'>;
  private cached: Manifest | null = null;

  constructor(http: Pick<HttpClient, 'getJson' | 'getText'>) {
    this.http = http;
  }

  async fetchVersionJson(versionId: string, dest: string): Promise<string> {
    return cachedJsonText(
      dest,
      (json) => json.id === versionId,
      async () => {
        this.cached ??= await this.http.getJson<Manifest>(MANIFEST_URL);
        const entry = this.cached.versions.find((v) => v.id === versionId);
        if (!entry) throw new Error(`Version Minecraft introuvable dans le manifest : ${versionId}`);
        const text = await this.http.getText(entry.url);
        if (!sha1Matches(text, entry.sha1)) throw new Error(`${versionId}.json : empreinte SHA-1 invalide`);
        return text;
      },
    );
  }
}
