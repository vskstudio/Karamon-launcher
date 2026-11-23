import { useEffect } from 'preact/hooks';
import arenes from '../../assets/art/arenes.webp';
import market from '../../assets/art/backdrop_market.webp';
import ile from '../../assets/art/ile.webp';
import pass from '../../assets/art/offer-pass.webp';
import spawn from '../../assets/art/spawn.webp';
import background from '../../assets/brand/background.webp';
import wordmark from '../../assets/brand/wordmark.webp';
import { loadPackInfo, packInfo } from '../../state/content';
import { navigate } from '../../state/navigation';
import { countdownTo, currentSeason, formatCountdown, now } from '../../state/season';
import { Glyph, Page, Panel, PanelButton, PixelIcon, Tag } from '../../ui';
import { PlayBar } from './PlayBar';
import { ServerCard } from './ServerCard';
import './home.css';

const explore = [
  { slug: 'mondes', title: 'Les mondes', subtitle: 'Ville, Ressources, Aventure', image: spawn },
  { slug: 'arenes', title: 'Arènes et badges', subtitle: '8 arènes à conquérir', image: arenes },
  { slug: 'iles', title: 'Ton île', subtitle: 'Agrandis-la, invite tes amis', image: ile },
  { slug: 'boutique', title: 'Boutique et grades', subtitle: 'Six grades permanents', image: market },
] as const;

function SeasonPill() {
  const countdown = countdownTo(currentSeason.endsAt, now.value);
  if (!countdown) return null;
  return (
    <button type="button" class="home__season" onClick={() => navigate('wiki', currentSeason.wikiSlug)}>
      <PixelIcon name="calendar" size={18} />
      <span>Fin de la {currentSeason.name.toLowerCase()} dans</span>
      <span class="mono home__season-time">{formatCountdown(countdown, true)}</span>
      <Glyph name="chevronRight" size={14} />
    </button>
  );
}

function PackTags() {
  const info = packInfo.value;
  if (!info) return null;
  return (
    <div class="home__tags">
      {info.baseName ? <Tag>{info.baseName}</Tag> : null}
      <Tag>Minecraft {info.minecraft}</Tag>
      <Tag>
        {info.loader === 'fabric' ? 'Fabric' : info.loader} {info.loaderVersion}
      </Tag>
      {info.version ? (
        <Tag tone={info.upToDate === false ? 'warning' : 'success'} dot>
          Pack {info.version} {info.upToDate === false ? 'à mettre à jour' : 'à jour'}
        </Tag>
      ) : null}
    </div>
  );
}

const guides = [
  { slug: 'bien-debuter', title: 'Bien débuter', pixel: 'star' },
  { slug: 'commandes', title: 'Commandes utiles', pixel: 'spellbook' },
  { slug: 'menu-k', title: 'Le menu K', pixel: 'emblem' },
] as const;

function GuidesCard() {
  return (
    <Panel
      class="home__guides-card"
      variant="glass"
      title="Guides"
      actions={
        <button type="button" class="home__more" onClick={() => navigate('wiki')}>
          Tout le wiki
        </button>
      }
    >
      <div class="home__guides">
        {guides.map((guide) => (
          <button key={guide.slug} type="button" class="home__guide" onClick={() => navigate('wiki', guide.slug)}>
            <PixelIcon name={guide.pixel} size={20} />
            <span class="home__guide-title">{guide.title}</span>
            <Glyph name="chevronRight" size={14} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function HomePage() {
  useEffect(() => {
    void loadPackInfo();
  }, []);

  return (
    <Page label="Accueil" scroll={false} padded={false} class="home">
      <img class="home__art pixelated" src={background} alt="" />
      <div class="home__veil" aria-hidden="true" />
      <div class="home__grid">
        <div class="home__hero">
          <SeasonPill />
          <img class="home__wordmark" src={wordmark} alt="Karamon" />
          <p class="home__pitch">
            Le serveur Cobblemon français. Huit arènes, un classé, des raids légendaires et ton île à faire grandir.
          </p>
          <PackTags />
        </div>
        <aside class="home__aside" aria-label="En direct">
          <ServerCard />
          <PanelButton onClick={() => navigate('shop')} padding="sm" class="home__pass surface--lumis">
            <img class="float" src={pass} alt="" width={64} height={56} />
            <span class="home__pass-text">
              <span class="ui-eyebrow home__pass-eyebrow">Pass Karamon</span>
              <strong>Des Lumis chaque mois</strong>
              <span>Grade Lumineux et /pc</span>
            </span>
          </PanelButton>
          <GuidesCard />
        </aside>
      </div>
      <nav class="home__explore" aria-label="Explorer le wiki">
        {explore.map((tile) => (
          <button key={tile.slug} type="button" class="home__tile" onClick={() => navigate('wiki', tile.slug)}>
            <img src={tile.image} alt="" />
            <span class="home__tile-text">
              <strong>{tile.title}</strong>
              <span>{tile.subtitle}</span>
            </span>
          </button>
        ))}
      </nav>
      <PlayBar />
    </Page>
  );
}
