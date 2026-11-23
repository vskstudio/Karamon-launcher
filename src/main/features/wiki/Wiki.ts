import type { WikiGroup, WikiPage } from '../../../ipc/contract.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';
import { JsonFileCache } from '../../shared/JsonFileCache.ts';
import { parseWikiIndex, parseWikiPage, WIKI_ORIGIN, WIKI_SLUG } from './WikiParser.ts';

const WIKI_FETCH_TIMEOUT_MS = 8000;
const INDEX_CACHE_NAME = 'index';
const HTTP_NOT_FOUND = 404;
const PAGE_GONE = Symbol('page-gone');

export class Wiki {
  private readonly http: Pick<HttpClient, 'get'>;
  private readonly disk: JsonFileCache;
  private freshIndex: WikiGroup[] | null = null;
  private readonly freshPages = new Map<string, WikiPage>();

  constructor(http: Pick<HttpClient, 'get'>, cacheDir: string) {
    this.http = http;
    this.disk = new JsonFileCache(cacheDir);
  }

  async index(): Promise<WikiGroup[]> {
    if (this.freshIndex) return this.freshIndex;
    const html = await this.fetchHtml(`${WIKI_ORIGIN}/wiki`);
    const groups = typeof html === 'string' ? parseWikiIndex(html) : [];
    if (groups.length === 0) return this.disk.read<WikiGroup[]>(INDEX_CACHE_NAME) ?? [];
    this.freshIndex = groups;
    this.disk.write(INDEX_CACHE_NAME, groups);
    return groups;
  }

  async page(slug: string): Promise<WikiPage | null> {
    if (!WIKI_SLUG.test(slug)) return null;
    const known = this.freshPages.get(slug);
    if (known) return known;
    const html = await this.fetchHtml(`${WIKI_ORIGIN}/wiki/${slug}`);
    if (html === PAGE_GONE) return null;
    const page = html ? parseWikiPage(slug, html) : null;
    const cacheName = `page-${slug}`;
    if (!page) return this.disk.read<WikiPage>(cacheName);
    this.freshPages.set(slug, page);
    this.disk.write(cacheName, page);
    return page;
  }

  private async fetchHtml(url: string): Promise<string | typeof PAGE_GONE | null> {
    try {
      const response = await this.http.get(url, { timeoutMs: WIKI_FETCH_TIMEOUT_MS });
      if (response.status === HTTP_NOT_FOUND) return PAGE_GONE;
      if (response.status < 200 || response.status >= 300) return null;
      return response.body.toString('utf8');
    } catch {
      return null;
    }
  }
}
