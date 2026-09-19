import type { HttpClient } from './HttpClient';

export interface GitHubDownloadRef {
  owner: string;
  repo: string;
  tag: string;
  filename: string;
}

interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  updated_at?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

const LATEST_DOWNLOAD =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/([^/?#]+)/i;
const TAGGED_DOWNLOAD =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)/i;

export function parseGitHubDownloadUrl(url: string): GitHubDownloadRef | null {
  const latest = url.match(LATEST_DOWNLOAD);
  if (latest) {
    return {
      owner: decodeURIComponent(latest[1]),
      repo: decodeURIComponent(latest[2]),
      tag: 'latest',
      filename: decodeURIComponent(latest[3]),
    };
  }
  const tagged = url.match(TAGGED_DOWNLOAD);
  if (tagged) {
    return {
      owner: decodeURIComponent(tagged[1]),
      repo: decodeURIComponent(tagged[2]),
      tag: decodeURIComponent(tagged[3]),
      filename: decodeURIComponent(tagged[4]),
    };
  }
  return null;
}

export async function githubAssetFreshness(http: HttpClient, fileUrl: string): Promise<string | null> {
  const ref = parseGitHubDownloadUrl(fileUrl);
  if (!ref) return null;
  const apiUrl =
    ref.tag === 'latest'
      ? `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`
      : `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/tags/${encodeURIComponent(ref.tag)}`;
  try {
    const release = await http.getJson<GitHubRelease>(apiUrl);
    const asset = (release.assets ?? []).find((item) => item.name === ref.filename);
    if (!asset) return null;
    return `${asset.id}-${asset.updated_at ?? asset.size}`;
  } catch {
    return null;
  }
}
