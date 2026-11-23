import { api } from '../../state/api';
import { navigate } from '../../state/navigation';

const WIKI_HOST = 'karamon.fr';
export const WIKI_SITE = 'https://karamon.fr/wiki/';

export interface WikiTarget {
  slug: string | null;
  anchor: string | null;
}

export function parseWikiParam(param: string | null): WikiTarget {
  if (!param) return { slug: null, anchor: null };
  const hashAt = param.indexOf('#');
  if (hashAt < 0) return { slug: param, anchor: null };
  return { slug: param.slice(0, hashAt) || null, anchor: param.slice(hashAt + 1) || null };
}

export function openWikiPage(slug: string, anchor: string | null = null): void {
  navigate('wiki', anchor ? `${slug}#${anchor}` : slug);
}

export function headingDomId(anchor: string): string {
  return `wiki-${anchor}`;
}

function parsedUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isWikiImage(src: string): boolean {
  const url = parsedUrl(src);
  return url !== null && url.protocol === 'https:' && url.hostname === WIKI_HOST;
}

function decodedHash(url: URL | null): string | null {
  const hash = url?.hash.slice(1) ?? '';
  if (!hash) return null;
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

export function followWikiLink(href: string, wikiSlug: string | null): void {
  if (wikiSlug) {
    openWikiPage(wikiSlug, decodedHash(parsedUrl(href)));
    return;
  }
  const url = parsedUrl(href);
  if (url && (url.protocol === 'https:' || url.protocol === 'http:')) void api.openExternal(url.toString());
}
