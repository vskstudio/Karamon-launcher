import type { LauncherApi, ShopOffer } from '../../ipc/contract';
import { $ } from '../util/dom';

const SHOP_URL = 'https://karamon.fr/boutique';
const NUMBER = new Intl.NumberFormat('fr-FR');

export class ShopView {
  private readonly api: LauncherApi;
  private loaded = false;

  constructor(api: LauncherApi) {
    this.api = api;
  }

  attach(): void {
    if (this.loaded) return;
    this.loaded = true;
    $('btn-open-shop').addEventListener('click', () => void this.api.openExternal(SHOP_URL));
    void this.load();
  }

  private async load(): Promise<void> {
    const grid = $('shop-offers');
    const offers = await this.api.listShopOffers();
    grid.textContent = '';
    if (offers.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'La boutique est momentanément indisponible. Retrouve-la sur karamon.fr.';
      grid.appendChild(hint);
      this.loaded = false;
      return;
    }
    for (const offer of offers) grid.appendChild(this.card(offer));
  }

  private card(offer: ShopOffer): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'offer-card';
    card.addEventListener('click', () => void this.api.openExternal(SHOP_URL));

    if (offer.bonus > 0) {
      const bonus = document.createElement('span');
      bonus.className = 'offer-card__bonus';
      bonus.textContent = `+${NUMBER.format(offer.bonus)} bonus`;
      card.appendChild(bonus);
    }

    const art = document.createElement('div');
    art.className = 'offer-card__art';
    if (offer.image) {
      const img = document.createElement('img');
      img.src = offer.image;
      img.alt = '';
      img.loading = 'lazy';
      art.appendChild(img);
    }

    const name = document.createElement('h3');
    name.textContent = offer.name;

    const price = document.createElement('span');
    price.className = 'offer-card__price';
    price.textContent = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: offer.currency.toUpperCase(),
    }).format(offer.priceCents / 100);

    const info = document.createElement('div');
    info.append(name, price);
    const buy = document.createElement('span');
    buy.className = 'offer-card__buy';
    buy.textContent = 'Acheter';
    const foot = document.createElement('div');
    foot.className = 'offer-card__foot';
    foot.append(info, buy);

    card.append(art, foot);
    return card;
  }
}
