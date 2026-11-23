import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { location, navigate } from '../../state/navigation';
import { loadWikiIndex, loadWikiPage, wikiEntries, wikiIndex, wikiPages } from '../../state/wiki';
import { Button, EmptyState, Page, Spinner } from '../../ui';
import { WikiArticle } from './WikiArticle';
import { WikiHome } from './WikiHome';
import { WikiNav } from './WikiNav';
import { headingDomId, parseWikiParam } from './wikiLinks';
import { KARAMON } from '../../../shared/Karamon';
import './wiki.css';

function WikiLoading({ label }: { label: string }) {
  return (
    <div class="wiki-state">
      <Spinner size={28} label={label} />
    </div>
  );
}

function WikiBody({ slug }: { slug: string | null }) {
  const entries = wikiEntries.value;
  const index = wikiIndex.value;

  if (!slug) {
    if (index.status === 'error') {
      return (
        <div class="wiki-state">
          <EmptyState
            pixel="spellbook"
            title="Wiki indisponible"
            actions={
              <Button variant="primary" glyph="refresh" onClick={() => void loadWikiIndex(true)}>
                Réessayer
              </Button>
            }
          >
            Le launcher n’a pas pu joindre {KARAMON.websiteHost} et le wiki n’est pas encore en cache. Vérifie ta connexion puis réessaie.
          </EmptyState>
        </div>
      );
    }
    if (index.status === 'ready' && entries.length > 0) return <WikiHome entries={entries} />;
    if (index.status === 'ready') {
      return (
        <div class="wiki-state">
          <EmptyState pixel="spellbook" title="Le wiki est vide">
            Aucune page n’est publiée pour l’instant.
          </EmptyState>
        </div>
      );
    }
    return <WikiLoading label="Chargement du wiki" />;
  }

  const state = wikiPages.value[slug];
  if (!state || state.status === 'loading') return <WikiLoading label="Chargement de la page" />;

  if (state.status === 'error') {
    return (
      <div class="wiki-state">
        <EmptyState
          pixel="globe"
          title="Page indisponible hors ligne"
          actions={
            <Button variant="primary" glyph="refresh" onClick={() => void loadWikiPage(slug, true)}>
              Réessayer
            </Button>
          }
        >
          Cette page n’est pas encore en cache et {KARAMON.websiteHost} ne répond pas. Vérifie ta connexion puis réessaie.
        </EmptyState>
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div class="wiki-state">
        <EmptyState
          pixel="magnifier"
          title="Page introuvable"
          actions={
            <Button glyph="chevronLeft" onClick={() => navigate('wiki')}>
              Retour au wiki
            </Button>
          }
        >
          Cette page n’existe pas ou a été déplacée sur le wiki.
        </EmptyState>
      </div>
    );
  }

  const position = entries.findIndex((entry) => entry.slug === slug);
  const entry = position >= 0 ? entries[position] : undefined;
  return (
    <WikiArticle
      page={state.page}
      group={state.page.group || entry?.group || ''}
      previous={position > 0 ? (entries[position - 1] ?? null) : null}
      next={position >= 0 ? (entries[position + 1] ?? null) : null}
    />
  );
}

export function WikiPage({ param }: { param: string | null }) {
  const target = parseWikiParam(param);
  const slug = target.slug;
  const ready = slug !== null && wikiPages.value[slug]?.status === 'ready';
  const visit = location.value;
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadWikiIndex();
  }, []);

  useEffect(() => {
    if (slug) void loadWikiPage(slug);
  }, [slug]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const heading = ready && target.anchor ? document.getElementById(headingDomId(target.anchor)) : null;
    if (heading && scroller.contains(heading)) heading.scrollIntoView({ block: 'start' });
    else scroller.scrollTop = 0;
  }, [visit, ready]);

  return (
    <Page label="Wiki" scroll={false} padded={false} class="wiki">
      <div class="wiki__layout">
        <WikiNav activeSlug={slug} />
        <div ref={scrollerRef} class="wiki__scroller">
          <WikiBody slug={slug} />
        </div>
      </div>
    </Page>
  );
}
