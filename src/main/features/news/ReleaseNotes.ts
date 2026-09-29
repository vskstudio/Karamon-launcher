import type { ReleaseNote } from '../../../ipc/contract';
import type { HttpClient } from '../../shared/HttpClient';

const RELEASES_URL = 'https://api.github.com/repos/vskstudio/Karamon-launcher/releases?per_page=20';
const TAG_PREFIX = 'launcher-v';
const MAX_HIGHLIGHTS = 3;

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

/** The bullets under "## Nouveautés"; releases published before that section existed have none. */
export function releaseHighlights(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Nouveautés\s*$/.test(line.trim()));
  if (start < 0) return [];
  const highlights: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) highlights.push(bullet[1].trim());
    if (highlights.length === MAX_HIGHLIGHTS) break;
  }
  return highlights;
}

export function parseReleases(raw: unknown, limit: number): ReleaseNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: ReleaseNote[] = [];
  for (const release of raw as GitHubRelease[]) {
    const tag = release.tag_name ?? '';
    if (!tag.startsWith(TAG_PREFIX) || release.draft || release.prerelease) continue;
    const publishedAt = release.published_at ? Date.parse(release.published_at) : NaN;
    notes.push({
      version: tag.slice(TAG_PREFIX.length),
      url: release.html_url ?? '',
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
      highlights: releaseHighlights(release.body ?? ''),
    });
    if (notes.length === limit) break;
  }
  return notes;
}

export class ReleaseNotes {
  private readonly http: HttpClient;
  private cache: Promise<ReleaseNote[]> | null = null;

  constructor(http: HttpClient) {
    this.http = http;
  }

  list(limit = 3): Promise<ReleaseNote[]> {
    if (!this.cache) {
      this.cache = this.http
        .getJson<unknown>(RELEASES_URL)
        .then((raw) => parseReleases(raw, limit))
        .catch(() => {
          this.cache = null;
          return [];
        });
    }
    return this.cache;
  }
}
