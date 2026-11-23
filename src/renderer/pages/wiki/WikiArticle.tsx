import { useState } from 'preact/hooks';
import castle from '../../assets/art/backdrop_castle.webp';
import forest from '../../assets/art/backdrop_forest.webp';
import galaxy from '../../assets/art/backdrop_galaxy.webp';
import market from '../../assets/art/backdrop_market.webp';
import portal from '../../assets/art/backdrop_portal.webp';
import type { WikiPage } from '../../../ipc/contract';
import { api } from '../../state/api';
import type { WikiEntry } from '../../state/wiki';
import { Button, cx, Glyph, PanelButton } from '../../ui';
import { WikiBlocks } from './WikiBlocks';
import { isWikiImage, openWikiPage, WIKI_SITE } from './wikiLinks';

const defaultCovers = [castle, forest, galaxy, market, portal] as const;
const MIN_TOC_HEADINGS = 3;

function defaultCoverOf(slug: string): string {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return defaultCovers[hash % defaultCovers.length] ?? castle;
}

function WikiCover({ page, group }: { page: WikiPage; group: string }) {
  const remote = page.cover && isWikiImage(page.cover) ? page.cover : null;
  const [remoteFailed, setRemoteFailed] = useState(false);
  const src = remote && !remoteFailed ? remote : defaultCoverOf(page.slug);
  return (
    <header class="wiki-cover">
      <img class="wiki-cover__art pixelated" src={src} alt="" onError={() => setRemoteFailed(true)} />
      <div class="wiki-cover__veil" aria-hidden="true" />
      <div class="wiki-cover__text">
        <div class="wiki-cover__titles">
          <p class="ui-eyebrow wiki-cover__crumbs">{group ? `Wiki · ${group}` : 'Wiki'}</p>
          <h1 class="wiki-cover__title selectable">{page.title}</h1>
        </div>
        <Button size="sm" glyph="external" onClick={() => void api.openExternal(`${WIKI_SITE}${page.slug}`)}>
          Ouvrir sur le site
        </Button>
      </div>
    </header>
  );
}

function WikiToc({ slug, headings }: { slug: string; headings: readonly { id: string; text: string }[] }) {
  return (
    <nav class="wiki-toc" aria-label="Sur cette page">
      <p class="ui-eyebrow wiki-toc__title">Sur cette page</p>
      <ul class="wiki-toc__list">
        {headings.map((heading) => (
          <li key={heading.id}>
            <button type="button" class="wiki-toc__item" onClick={() => openWikiPage(slug, heading.id)}>
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PagerLink({ entry, direction }: { entry: WikiEntry; direction: 'previous' | 'next' }) {
  const previous = direction === 'previous';
  return (
    <PanelButton onClick={() => openWikiPage(entry.slug)} class={cx('wiki-pager__link', !previous && 'wiki-pager__link--next')}>
      <span class="wiki-pager__direction">
        {previous ? <Glyph name="chevronLeft" size={14} /> : null}
        {previous ? 'Page précédente' : 'Page suivante'}
        {previous ? null : <Glyph name="chevronRight" size={14} />}
      </span>
      <span class="wiki-pager__name">{entry.title}</span>
    </PanelButton>
  );
}

interface WikiArticleProps {
  page: WikiPage;
  group: string;
  previous: WikiEntry | null;
  next: WikiEntry | null;
}

export function WikiArticle({ page, group, previous, next }: WikiArticleProps) {
  const headings = page.blocks.flatMap((block) => (block.kind === 'heading' && block.level === 2 ? [{ id: block.id, text: block.text }] : []));
  const showToc = headings.length >= MIN_TOC_HEADINGS;
  return (
    <article class="wiki-article" aria-label={page.title}>
      <WikiCover key={page.slug} page={page} group={group} />
      <div class={cx('wiki-body', showToc && 'wiki-body--toc')}>
        {showToc ? <WikiToc slug={page.slug} headings={headings} /> : null}
        <div class="wiki-main">
          <div class="wiki-content selectable">
            {page.lede ? <p class="wiki-lede">{page.lede}</p> : null}
            <WikiBlocks blocks={page.blocks} />
          </div>
          {previous || next ? (
            <nav class="wiki-pager" aria-label="Pages voisines">
              {previous ? <PagerLink entry={previous} direction="previous" /> : <span />}
              {next ? <PagerLink entry={next} direction="next" /> : <span />}
            </nav>
          ) : null}
        </div>
      </div>
    </article>
  );
}
