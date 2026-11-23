import path from 'path';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { cachedJsonText } from './CachedJson.ts';

export interface FabricInstallerOptions {
  mcVersion: string;
  fabricVersion: string;
  http: Pick<HttpClient, 'getText'>;
}

export class FabricInstaller {
  readonly versionId: string;
  private readonly profileUrl: string;
  private readonly http: Pick<HttpClient, 'getText'>;

  constructor({ mcVersion, fabricVersion, http }: FabricInstallerOptions) {
    this.http = http;
    this.versionId = `fabric-loader-${fabricVersion}-${mcVersion}`;
    this.profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${fabricVersion}/profile/json`;
  }

  profileJson(versionsDir: string): Promise<string> {
    const file = path.join(versionsDir, this.versionId, `${this.versionId}.json`);
    return cachedJsonText(file, (json) => json.id === this.versionId, () => this.http.getText(this.profileUrl));
  }

  async ensureVersion(mcLauncherDir: string): Promise<void> {
    await this.profileJson(path.join(mcLauncherDir, 'versions'));
  }
}
