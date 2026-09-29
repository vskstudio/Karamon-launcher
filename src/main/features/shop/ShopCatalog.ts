import type { ShopOffer } from '../../../ipc/contract';
import type { HttpClient } from '../../shared/HttpClient';

const OFFERS_URL = 'https://karamon.fr/api/shop/offers';
const IMAGE_ORIGIN = 'https://karamon.fr/';

interface RawOffer {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  koins?: unknown;
  bonus?: unknown;
  unit_amount?: unknown;
  currency?: unknown;
  rank?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

/** Offers the launcher can show, cheapest rank first; malformed entries are dropped. */
export function parseOffers(raw: unknown): ShopOffer[] {
  const list = (raw as { offers?: unknown } | null)?.offers;
  if (!Array.isArray(list)) return [];
  const offers: (ShopOffer & { rank: number })[] = [];
  for (const offer of list as RawOffer[]) {
    const id = text(offer.id);
    const name = text(offer.name);
    const priceCents = count(offer.unit_amount);
    const currency = text(offer.currency);
    if (!id || !name || priceCents === 0 || !/^[a-z]{3}$/i.test(currency)) continue;
    const image = text(offer.image);
    offers.push({
      id,
      name,
      description: text(offer.description),
      image: image.startsWith(IMAGE_ORIGIN) ? image : '',
      lumis: count(offer.koins),
      bonus: count(offer.bonus),
      priceCents,
      currency: currency.toLowerCase(),
      rank: count(offer.rank),
    });
  }
  return offers.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...offer }) => offer);
}

export class ShopCatalog {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async offers(): Promise<ShopOffer[]> {
    try {
      return parseOffers(await this.http.getJson<unknown>(OFFERS_URL));
    } catch {
      return [];
    }
  }
}
