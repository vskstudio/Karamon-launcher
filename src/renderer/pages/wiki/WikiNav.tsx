import { useEffect, useRef, useState } from 'preact/hooks';
import type { WikiGroup } from '../../../ipc/contract';
import { loadWikiIndex, wikiIndex } from '../../state/wiki';
import { navigate } from '../../state/navigation';
import { Button, cx, PixelIcon, Spinner, TextField } from '../../ui';
import { isWikiImage, openWikiPage } from './wikiLinks';

function searchable(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function filterGroups(groups: readonly WikiGroup[], query: string): WikiGroup[] {
  const needle = searchable(query);
  if (!needle) return [...groups];
  return groups
    .map((group) => ({ ...group, pages: group.pages.filter((page) => searchable(page.title).includes(needle)) }))
    .filter((group) => group.pages.length > 0);
}

function NavIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !isWikiImage(src)) return <PixelIcon name="spellbook" size={18} />;
  return <img class="pixelated" src={src} width={18} height={18} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function WikiNav({ activeSlug }: { activeSlug: string | null }) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const index = wikiIndex.value;

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeSlug, index.status]);

  const groups = index.status === 'ready' ? filterGroups(index.data, query) : [];

  return (
    <nav class="wiki-nav" aria-label="Pages du wiki">
      <TextField type="search" label="Chercher dans le wiki" hideLabel placeholder="Chercher dans le wiki" value={query} onInput={setQuery} class="wiki-nav__search" />
      <button type="button" class={cx('wiki-nav__item', 'wiki-nav__home', activeSlug === null && 'is-active')} aria-current={activeSlug === null ? 'page' : undefined} onClick={() => navigate('wiki')}>
        <PixelIcon name="spellbook" size={18} />
        <span class="wiki-nav__title">Accueil du wiki</span>
      </button>
      <div ref={listRef} class="wiki-nav__list">
        {index.status === 'loading' || index.status === 'idle' ? (
          <div class="wiki-nav__state">
            <Spinner size={20} label="Chargement du sommaire" />
          </div>
        ) : null}
        {index.status === 'error' ? (
          <div class="wiki-nav__state">
            <p>Sommaire indisponible hors ligne.</p>
            <Button size="sm" glyph="refresh" onClick={() => void loadWikiIndex(true)}>
              Réessayer
            </Button>
          </div>
        ) : null}
        {index.status === 'ready' && groups.length === 0 ? <p class="wiki-nav__empty">Aucune page ne correspond.</p> : null}
        {groups.map((group) => (
          <div key={group.name} class="wiki-nav__group">
            <h2 class="wiki-nav__heading">{group.name}</h2>
            <ul class="wiki-nav__pages">
              {group.pages.map((page) => {
                const active = page.slug === activeSlug;
                return (
                  <li key={page.slug}>
                    <button
                      type="button"
                      class={cx('wiki-nav__item', active && 'is-active')}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => openWikiPage(page.slug)}
                    >
                      <NavIcon src={page.icon} />
                      <span class="wiki-nav__title">{page.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
