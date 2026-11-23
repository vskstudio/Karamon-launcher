import cover from '../../assets/art/backdrop_galaxy.webp';
import { api } from '../../state/api';
import { countdownTo, currentSeason, formatCountdown, now } from '../../state/season';
import type { WikiEntry } from '../../state/wiki';
import { wikiIndex } from '../../state/wiki';
import { Button, Glyph, PixelIcon } from '../../ui';
import { isWikiImage, openWikiPage, WIKI_SITE } from './wikiLinks';

const FEATURED = ['bien-debuter', 'commandes', 'boutique'] as const;

function EntryIcon({ entry, size }: { entry: { icon: string }; size: number }) {
  if (entry.icon && isWikiImage(entry.icon)) {
    return <img class="pixelated" src={entry.icon} alt="" width={size} height={size} draggable={false} />;
  }
  return <PixelIcon name="spellbook" size={size} />;
}

function SeasonCallout() {
  const countdown = countdownTo(currentSeason.endsAt, now.value);
  if (!countdown) return null;
  return (
    <button type="button" class="wiki-home__season surface surface--lumis" onClick={() => openWikiPage(currentSeason.wikiSlug)}>
      <PixelIcon name="calendar" size={32} />
      <span class="wiki-home__season-text">
        <span class="ui-eyebrow wiki-home__season-eyebrow">{currentSeason.name}</span>
        <strong>Ce qui se passe à la fin de la saison</strong>
        <span>
          Encore <span class="mono">{formatCountdown(countdown, false)}</span> pour récupérer tes récompenses.
        </span>
      </span>
      <Glyph name="chevronRight" size={18} />
    </button>
  );
}

export function WikiHome({ entries }: { entries: WikiEntry[] }) {
  const groups = wikiIndex.value.status === 'ready' ? wikiIndex.value.data : [];
  const featured = FEATURED.map((slug) => entries.find((entry) => entry.slug === slug)).filter(
    (entry): entry is WikiEntry => entry !== undefined,
  );

  return (
    <div class="wiki-home">
      <header class="wiki-home__hero">
        <img class="wiki-home__cover pixelated" src={cover} alt="" />
        <div class="wiki-home__hero-text">
          <p class="ui-eyebrow">Wiki Karamon</p>
          <h1 class="wiki-home__title">Tout pour bien jouer</h1>
          <p class="wiki-home__lede">
            Les mondes, la progression, les Pokémon rares, l’économie et les guildes. Lisible même pendant une partie, et hors ligne avec la
            dernière copie.
          </p>
        </div>
        <Button size="sm" glyph="external" onClick={() => void api.openExternal(WIKI_SITE)}>
          Ouvrir sur le site
        </Button>
      </header>

      <div class="wiki-home__top">
        {featured.length > 0 ? (
          <section class="wiki-home__featured" aria-label="Pour commencer">
            {featured.map((entry) => (
              <button key={entry.slug} type="button" class="wiki-home__feature surface" onClick={() => openWikiPage(entry.slug)}>
                <EntryIcon entry={entry} size={36} />
                <span class="wiki-home__feature-text">
                  <span class="wiki-home__feature-group">{entry.group}</span>
                  <strong>{entry.title}</strong>
                </span>
              </button>
            ))}
          </section>
        ) : null}
        <SeasonCallout />
      </div>

      <div class="wiki-home__groups">
        {groups.map((group) => (
          <section key={group.name} class="wiki-home__group" aria-label={group.name}>
            <h2 class="ui-eyebrow">{group.name}</h2>
            <div class="wiki-home__cards">
              {group.pages.map((page) => (
                <button key={page.slug} type="button" class="wiki-home__card" onClick={() => openWikiPage(page.slug)}>
                  <EntryIcon entry={page} size={24} />
                  <span>{page.title}</span>
                  <Glyph name="chevronRight" size={14} class="wiki-home__card-arrow" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
