import { HTMLElement, NodeType, parse, type Node } from 'node-html-parser';
import { WIKI_SLUG_PATTERN } from '../../../shared/WikiSlug.ts';
import type { WikiBlock, WikiCalloutTone, WikiGroup, WikiInline, WikiPage, WikiPageRef } from './WikiTypes.ts';

import { KARAMON } from '../../shared/KaramonProfile.ts';

export const WIKI_ORIGIN = KARAMON.websiteUrl;
const WIKI_HOST = KARAMON.websiteHost;
const WIKI_PATH = new RegExp(`^/wiki/(${WIKI_SLUG_PATTERN})/?$`);
const CALLOUT_TONES: readonly WikiCalloutTone[] = ['note', 'tip', 'warning', 'important'];
const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'li', 'table', 'tr', 'aside', 'figure', 'figcaption', 'h2', 'h3', 'h4', 'section']);
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'button', 'input', 'template', 'hr']);

const isElement = (node: Node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE;
const tagOf = (element: HTMLElement): string => element.tagName?.toLowerCase() ?? '';
const collapse = (text: string): string => text.replace(/\s+/g, ' ');
const plainText = (element: HTMLElement): string => collapse(element.text).trim();

function wikiImageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, `${WIKI_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== WIKI_HOST || url.port !== '') return null;
  return url.toString();
}

function wikiSlugOf(url: URL): string | null {
  if (url.hostname !== WIKI_HOST || url.protocol !== 'https:') return null;
  return WIKI_PATH.exec(url.pathname)?.[1] ?? null;
}

function slugFromHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return wikiSlugOf(new URL(href, `${WIKI_ORIGIN}/`));
  } catch {
    return null;
  }
}

class InlineCollector {
  readonly items: WikiInline[] = [];
  private readonly pageUrl: string;

  constructor(pageUrl: string) {
    this.pageUrl = pageUrl;
  }

  addAll(nodes: Node[]): void {
    for (const node of nodes) this.add(node);
  }

  private pushText(text: string): void {
    if (!text) return;
    const last = this.items[this.items.length - 1];
    if (last?.kind === 'text') last.text = collapse(last.text + text);
    else this.items.push({ kind: 'text', text: collapse(text) });
  }

  private nested(nodes: Node[]): WikiInline[] {
    const collector = new InlineCollector(this.pageUrl);
    collector.addAll(nodes);
    return collector.items;
  }

  private add(node: Node): void {
    if (node.nodeType === NodeType.TEXT_NODE) {
      this.pushText(node.text);
      return;
    }
    if (!isElement(node)) return;
    const tag = tagOf(node);
    if (SKIPPED_TAGS.has(tag) || node.classList.contains('wiki-anchor')) return;
    switch (tag) {
      case 'strong':
      case 'b':
        this.pushWrapped('strong', node);
        return;
      case 'em':
      case 'i':
        this.pushWrapped('em', node);
        return;
      case 'code':
      case 'kbd': {
        const text = collapse(node.text);
        if (text.trim()) this.items.push({ kind: 'code', text: text.trim() });
        return;
      }
      case 'br':
        this.pushText(' ');
        return;
      case 'img': {
        const src = wikiImageUrl(node.getAttribute('src'));
        if (src) this.items.push({ kind: 'image', src, alt: node.getAttribute('alt') ?? '' });
        return;
      }
      case 'a':
        this.pushLink(node);
        return;
      default:
        if (BLOCK_TAGS.has(tag)) this.pushText(' ');
        this.addAll(node.childNodes);
        if (BLOCK_TAGS.has(tag)) this.pushText(' ');
    }
  }

  private pushWrapped(kind: 'strong' | 'em', element: HTMLElement): void {
    const children = trimInlines(this.nested(element.childNodes));
    if (children.length > 0) this.items.push({ kind, children });
  }

  private pushLink(anchor: HTMLElement): void {
    const children = trimInlines(this.nested(anchor.childNodes));
    let target: URL | null = null;
    try {
      target = new URL(anchor.getAttribute('href') ?? '', this.pageUrl);
    } catch {
      target = null;
    }
    if (!target || target.protocol !== 'https:' || children.length === 0) {
      for (const child of children) {
        if (child.kind === 'text') this.pushText(child.text);
        else this.items.push(child);
      }
      return;
    }
    this.items.push({ kind: 'link', href: target.toString(), wikiSlug: wikiSlugOf(target), children });
  }
}

function trimInlines(items: WikiInline[]): WikiInline[] {
  const trimmed = items.map((item) => (item.kind === 'text' ? { ...item } : item));
  const first = trimmed[0];
  if (first?.kind === 'text') first.text = first.text.trimStart();
  const last = trimmed[trimmed.length - 1];
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  return trimmed.filter((item) => item.kind !== 'text' || item.text !== '');
}

function inlinesOf(nodes: Node[], pageUrl: string): WikiInline[] {
  const collector = new InlineCollector(pageUrl);
  collector.addAll(nodes);
  return trimInlines(collector.items);
}

class BlockCollector {
  readonly blocks: WikiBlock[] = [];
  private readonly pageUrl: string;

  constructor(pageUrl: string) {
    this.pageUrl = pageUrl;
  }

  addAll(nodes: Node[]): void {
    for (const node of nodes) this.add(node);
  }

  private paragraph(nodes: Node[]): void {
    const content = inlinesOf(nodes, this.pageUrl);
    if (content.length > 0) this.blocks.push({ kind: 'paragraph', content });
  }

  private add(node: Node): void {
    if (node.nodeType === NodeType.TEXT_NODE) {
      if (node.text.trim()) this.paragraph([node]);
      return;
    }
    if (!isElement(node)) return;
    const tag = tagOf(node);
    if (SKIPPED_TAGS.has(tag)) return;
    switch (tag) {
      case 'p':
        this.paragraph(node.childNodes);
        return;
      case 'h2':
      case 'h3':
      case 'h4': {
        const text = plainText(node);
        if (text) this.blocks.push({ kind: 'heading', level: tag === 'h2' ? 2 : 3, id: node.getAttribute('id') ?? '', text });
        return;
      }
      case 'ul':
      case 'ol':
        this.list(node, tag === 'ol');
        return;
      case 'aside':
        this.callout(node);
        return;
      case 'table':
        this.table(node);
        return;
      case 'figure':
        this.figure(node);
        return;
      case 'img':
        this.image(node, '');
        return;
      case 'div':
      case 'section':
        this.addAll(node.childNodes);
        return;
      default:
        this.paragraph([node]);
    }
  }

  private list(element: HTMLElement, ordered: boolean): void {
    const items = element.childNodes
      .filter((child): child is HTMLElement => isElement(child) && tagOf(child) === 'li')
      .map((item) => inlinesOf(item.childNodes, this.pageUrl))
      .filter((item) => item.length > 0);
    if (items.length > 0) this.blocks.push({ kind: 'list', ordered, items });
  }

  private callout(element: HTMLElement): void {
    const toneClass = [...element.classList.values()].find((name) => name.startsWith('callout--'));
    const tone = CALLOUT_TONES.find((candidate) => toneClass === `callout--${candidate}`) ?? 'note';
    const titleElement = element.childNodes.find(
      (child): child is HTMLElement => isElement(child) && child.classList.contains('callout__title'),
    );
    const inner = new BlockCollector(this.pageUrl);
    inner.addAll(element.childNodes.filter((child) => child !== titleElement));
    const title = titleElement ? plainText(titleElement) : '';
    if (!title && inner.blocks.length === 0) return;
    this.blocks.push({ kind: 'callout', tone, title, blocks: inner.blocks });
  }

  private table(element: HTMLElement): void {
    const rows = element.querySelectorAll('tr');
    const cellsOf = (row: HTMLElement): WikiInline[][] =>
      row.childNodes
        .filter((cell): cell is HTMLElement => isElement(cell) && (tagOf(cell) === 'td' || tagOf(cell) === 'th'))
        .map((cell) => inlinesOf(cell.childNodes, this.pageUrl));
    const isHeadRow = (row: HTMLElement): boolean =>
      tagOf(row.parentNode as HTMLElement) === 'thead' ||
      row.childNodes.filter(isElement).every((cell) => tagOf(cell) === 'th');
    const headRow = rows[0] && isHeadRow(rows[0]) ? rows[0] : null;
    const head = headRow ? cellsOf(headRow) : [];
    const body = rows.filter((row) => row !== headRow).map(cellsOf).filter((cells) => cells.length > 0);
    if (head.length === 0 && body.length === 0) return;
    this.blocks.push({ kind: 'table', head, rows: body });
  }

  private figure(element: HTMLElement): void {
    const captionElement = element.querySelector('figcaption');
    const caption = captionElement ? plainText(captionElement) : '';
    for (const image of element.querySelectorAll('img')) this.image(image, caption);
    if (captionElement) {
      const content = inlinesOf(captionElement.childNodes, this.pageUrl);
      if (content.length > 0) this.blocks.push({ kind: 'paragraph', content: [{ kind: 'em', children: content }] });
    }
  }

  private image(element: HTMLElement, fallbackAlt: string): void {
    const src = wikiImageUrl(element.getAttribute('src'));
    if (src) this.blocks.push({ kind: 'image', src, alt: element.getAttribute('alt') || fallbackAlt });
  }
}

function pageRef(anchor: HTMLElement, title: string): WikiPageRef | null {
  const slug = slugFromHref(anchor.getAttribute('href'));
  if (!slug || !title) return null;
  return { slug, title, icon: wikiImageUrl(anchor.querySelector('img')?.getAttribute('src')) ?? '' };
}

function groupsFromSideNav(nav: HTMLElement): WikiGroup[] {
  const groups: WikiGroup[] = [];
  let current: WikiGroup | null = null;
  for (const child of nav.childNodes.filter(isElement)) {
    if (child.classList.contains('wiki-nav__group')) {
      current = { name: plainText(child), pages: [] };
      groups.push(current);
    } else if (tagOf(child) === 'ul' && current) {
      for (const anchor of child.querySelectorAll('li > a')) {
        const ref = pageRef(anchor, plainText(anchor));
        if (ref) current.pages.push(ref);
      }
    }
  }
  return groups;
}

function groupsFromHomeCards(root: HTMLElement): WikiGroup[] {
  return root.querySelectorAll('section.wiki-group').map((section) => {
    const pages = section
      .querySelectorAll('a.wiki-card')
      .map((card) => pageRef(card, plainText(card.querySelector('strong') ?? card)))
      .filter((ref): ref is WikiPageRef => ref !== null);
    return { name: plainText(section.querySelector('h2') ?? section), pages };
  });
}

export function parseWikiIndex(html: string): WikiGroup[] {
  const root = parse(html);
  const nav = root.querySelector('nav.wiki-nav');
  const groups = nav ? groupsFromSideNav(nav) : groupsFromHomeCards(root);
  const seen = new Set<string>();
  return groups
    .map((group) => ({
      name: group.name,
      pages: group.pages.filter((page) => !seen.has(page.slug) && seen.add(page.slug)),
    }))
    .filter((group) => group.name && group.pages.length > 0);
}

function coverOf(header: HTMLElement | null): string | null {
  const style = header?.getAttribute('style') ?? '';
  const match = /--cover\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/.exec(style);
  return match ? wikiImageUrl(match[1]) : null;
}

function groupOf(crumbs: HTMLElement | null): string {
  if (!crumbs) return '';
  const parts = crumbs.text.split('›');
  return parts.length > 1 ? collapse(parts[parts.length - 1]).trim() : '';
}

export function parseWikiPage(slug: string, html: string): WikiPage | null {
  const article = parse(html).querySelector('article.wiki-article');
  if (!article) return null;
  const header = article.querySelector('header.wiki-head');
  const titleElement = article.querySelector('h1');
  const title = titleElement ? plainText(titleElement) : '';
  if (!title) return null;
  const lede = article.querySelector('.wiki-head__lede');
  const body = article.querySelector('.wiki-body');
  const pageUrl = `${WIKI_ORIGIN}/wiki/${slug}`;
  const blocks = new BlockCollector(pageUrl);
  if (body) blocks.addAll(body.childNodes);
  return {
    slug,
    title,
    group: groupOf(article.querySelector('.wiki-crumbs')),
    lede: lede ? plainText(lede) : '',
    icon: wikiImageUrl(header?.querySelector('.wiki-head__title img')?.getAttribute('src')) ?? '',
    cover: coverOf(header),
    blocks: blocks.blocks,
  };
}
