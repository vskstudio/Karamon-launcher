import { ExternalLink, Lock, ShoppingBag } from 'lucide';
import type { LauncherApi, ShopOffer } from '../../ipc/contract';
import { badge, button, card, emptyState, h, icon, pageHeader } from '../lib/ui';
import { formatNumber, formatPrice } from '../util/format';
import type { Page } from './Page';
import './ShopPage.css';

const SHOP_URL = 'https://karamon.fr/boutique';
const DEFAULT_OFFER_INDEX = 3;

interface ShopPageOptions {
  api: LauncherApi;
  playerName: () => string | null;
}

function baseLumis(offer: ShopOffer): number {
  return offer.lumis - offer.bonus;
}

function bonusPercent(offer: ShopOffer): number {
  const base = baseLumis(offer);
  return base > 0 ? Math.round((offer.bonus / base) * 100) : 0;
}

function art(offer: ShopOffer, className: string): HTMLElement {
  const frame = h('div', { className });
  if (offer.image) {
    const img = h('img', { attrs: { src: offer.image, alt: '', loading: 'lazy', draggable: 'false' } });
    img.addEventListener('error', () => img.remove());
    frame.append(img);
  }
  return frame;
}

export class ShopPage implements Page {
  readonly root: HTMLElement;
  private readonly api: LauncherApi;
  private readonly playerName: () => string | null;
  private readonly showcaseSlot = h('div', { className: 'shop-showcase-slot' });
  private readonly listSlot = h('div', { className: 'shop-list-slot' });
  private offers: ShopOffer[] = [];
  private selectedId: string | null = null;
  private loading = false;
  private loaded = false;
  private rows: HTMLElement[] = [];

  constructor(root: HTMLElement, options: ShopPageOptions) {
    this.root = root;
    this.api = options.api;
    this.playerName = options.playerName;
    root.append(
      pageHeader({
        title: 'Boutique',
        subtitle: 'Les Lumis se dépensent dans le menu Karamon, en jeu.',
        actions: [this.siteButton('ghost', 'karamon.fr/boutique')],
      }),
      h('div', { className: 'shop-layout' }, this.showcaseSlot, this.listSlot),
    );
    this.renderLoading();
  }

  enter(): void {
    if (this.loaded || this.loading) return;
    void this.load();
  }

  private siteButton(variant: 'ghost' | 'secondary', label: string): HTMLButtonElement {
    return button({ label, variant, icon: ExternalLink, onClick: () => void this.api.openExternal(SHOP_URL) });
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.renderLoading();
    let offers: ShopOffer[] = [];
    try {
      offers = await this.api.listShopOffers();
    } catch {
      offers = [];
    }
    this.loading = false;
    if (offers.length === 0) {
      this.renderUnavailable();
      return;
    }
    this.loaded = true;
    this.offers = offers;
    const fallback = offers[Math.min(DEFAULT_OFFER_INDEX, offers.length - 1)];
    this.selectedId = fallback ? fallback.id : null;
    this.renderList();
    this.renderShowcase();
  }

  private selected(): ShopOffer | undefined {
    return this.offers.find((offer) => offer.id === this.selectedId);
  }

  private renderLoading(): void {
    this.showcaseSlot.replaceChildren(
      card({ className: 'shop-showcase', body: [h('div', { className: 'shop-skeleton', attrs: { 'aria-busy': 'true' } })], flush: true }).root,
    );
    this.listSlot.replaceChildren(
      ...Array.from({ length: 6 }, () => h('div', { className: 'shop-skeleton shop-skeleton--row' })),
    );
  }

  private renderUnavailable(): void {
    const state = emptyState({
      icon: ShoppingBag,
      title: 'La boutique est momentanément indisponible',
      text: 'Retrouve-la directement sur karamon.fr.',
      action: this.siteButton('secondary', 'Ouvrir karamon.fr/boutique'),
    });
    this.showcaseSlot.replaceChildren(card({ className: 'shop-showcase shop-showcase--empty', body: [state] }).root);
    this.listSlot.replaceChildren();
  }

  private renderList(): void {
    const group = h('div', { className: 'shop-list', attrs: { role: 'radiogroup', 'aria-label': 'Offres de Lumis' } });
    this.rows = this.offers.map((offer) => this.buildRow(offer));
    group.append(...this.rows);
    this.listSlot.replaceChildren(group);
  }

  private buildRow(offer: ShopOffer): HTMLElement {
    const percent = bonusPercent(offer);
    const checked = offer.id === this.selectedId;
    const row = h(
      'div',
      {
        className: 'shop-row',
        attrs: {
          role: 'radio',
          'aria-checked': String(checked),
          tabindex: checked ? '0' : '-1',
          'data-offer': offer.id,
        },
      },
      h('span', { className: 'shop-radio', attrs: { 'aria-hidden': 'true' } }),
      art(offer, 'shop-row__art'),
      h(
        'span',
        { className: 'shop-row__amount' },
        h('span', { className: 'shop-row__value', text: formatNumber(offer.lumis) }),
        h('span', { className: 'shop-lumis-unit', text: 'Lumis' }),
      ),
      percent > 0 ? badge(`+${percent} %`, 'lumis') : null,
      h('span', { className: 'shop-row__price', text: formatPrice(offer.priceCents, offer.currency) }),
    );
    row.addEventListener('click', () => this.select(offer.id, false));
    row.addEventListener('keydown', (event) => this.onKey(event, offer.id));
    return row;
  }

  private onKey(event: KeyboardEvent, id: string): void {
    const index = this.offers.findIndex((offer) => offer.id === id);
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % this.offers.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + this.offers.length) % this.offers.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.offers.length - 1;
    else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.select(id, false);
      return;
    } else return;
    event.preventDefault();
    const target = this.offers[next];
    if (target) this.select(target.id, true);
  }

  private select(id: string, focus: boolean): void {
    this.selectedId = id;
    this.rows.forEach((row) => {
      const active = row.dataset.offer === id;
      row.setAttribute('aria-checked', String(active));
      row.tabIndex = active ? 0 : -1;
      if (active && focus) row.focus();
    });
    this.renderShowcase();
  }

  private renderShowcase(): void {
    const offer = this.selected();
    if (!offer) return;
    const percent = bonusPercent(offer);
    const price = formatPrice(offer.priceCents, offer.currency);
    const buy = button({
      label: `Acheter pour ${price}`,
      variant: 'primary',
      size: 'lg',
      onClick: () => void this.api.openExternal(SHOP_URL),
    });
    const player = this.playerName() ?? 'ton compte';

    const detail = (label: string, value: string, lumis: boolean) =>
      h(
        'div',
        { className: 'shop-detail' },
        h('span', { className: 'shop-detail__label', text: label }),
        h('span', { className: lumis ? 'shop-detail__value shop-detail__value--lumis' : 'shop-detail__value', text: value }),
      );

    const footer = h(
      'div',
      { className: 'shop-showcase__foot' },
      h(
        'div',
        { className: 'shop-showcase__info' },
        h(
          'div',
          { className: 'shop-showcase__amount' },
          h('span', { className: 'shop-showcase__value', text: formatNumber(offer.lumis) }),
          h('span', { className: 'shop-lumis-unit shop-lumis-unit--lg', text: 'Lumis' }),
          percent > 0 ? badge(`+${percent} % offerts`, 'lumis') : null,
        ),
        h(
          'div',
          { className: 'shop-details' },
          detail('Lumis de base', formatNumber(baseLumis(offer)), false),
          offer.bonus > 0 ? detail('Bonus', `+ ${formatNumber(offer.bonus)}`, true) : null,
        ),
      ),
      h(
        'div',
        { className: 'shop-showcase__buy' },
        buy,
        h(
          'p',
          { className: 'shop-secure' },
          icon(Lock, 12),
          h('span', { text: `Paiement sur karamon.fr, crédité sur ${player}` }),
        ),
      ),
    );

    this.showcaseSlot.replaceChildren(
      card({
        className: 'shop-showcase',
        flush: true,
        body: [art(offer, 'shop-showcase__art'), footer],
      }).root,
    );
  }
}
