import type { HttpClient } from './HttpClient.ts';

interface GitHubDownloadRef {
  owner: string;
  repo: string;
  tag: string;
  filename: string;
}

interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  digest?: string;
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
const GITHUB_RELEASE_DOWNLOAD_BASE =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/(?:latest\/download|download\/[^/]+)\/?$/i;

function githubReleaseAssetName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[()[\]]/g, '')
    .replace(/\s+/g, '.');
}

export function packAssetUrl(baseUrl: string, name: string, folderPrefix = ''): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const prefix = folderPrefix && !folderPrefix.endsWith('/') ? `${folderPrefix}/` : folderPrefix;
  const github = GITHUB_RELEASE_DOWNLOAD_BASE.test(base);
  const encoded = encodeURIComponent(github ? githubReleaseAssetName(name) : name);
  if (github) return base + encoded;
  return base + prefix + encoded;
}

function parseGitHubDownloadUrl(url: string): GitHubDownloadRef | null {
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

function assetFreshnessKey(asset: { size?: number; digest?: string }): string | null {
  const digest = typeof asset.digest === 'string' ? asset.digest.trim().toLowerCase() : '';
  if (/^sha256:[0-9a-f]{64}$/.test(digest)) return digest;
  if (typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0) {
    return `size:${asset.size}`;
  }
  return null;
}

export type GitHubFreshness =
  | { kind: 'not-github' }
  | { kind: 'found'; key: string }
  | { kind: 'unknown'; reason: string };

export async function githubAssetFreshness(http: Pick<HttpClient, 'getJson'>, fileUrl: string): Promise<GitHubFreshness> {
  const ref = parseGitHubDownloadUrl(fileUrl);
  if (!ref) return { kind: 'not-github' };
  const apiUrl =
    ref.tag === 'latest'
      ? `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`
      : `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/tags/${encodeURIComponent(ref.tag)}`;
  let release: GitHubRelease;
  try {
    release = await http.getJson<GitHubRelease>(apiUrl);
  } catch (e) {
    return { kind: 'unknown', reason: `API GitHub: ${(e as Error).message}` };
  }
  const asset = (release.assets ?? []).find((item) => item.name === ref.filename);
  if (!asset) return { kind: 'unknown', reason: `${ref.filename} absent de la release ${ref.tag}` };
  const key = assetFreshnessKey(asset);
  return key ? { kind: 'found', key } : { kind: 'unknown', reason: `${ref.filename} sans taille ni empreinte` };
}
