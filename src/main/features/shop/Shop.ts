import type {
  MinecraftProfile,
  ShopCatalog,
  ShopCheckoutResult,
  ShopOffer,
  ShopOfferKind,
} from '../../../ipc/contract.ts';
import type { HttpClient, HttpResponse } from '../../shared/HttpClient.ts';
import { isStripeCheckoutPage } from './CheckoutNavigation.ts';
import type { CheckoutOutcome } from './CheckoutWindow.ts';

const SHOP_API = 'https://karamon.fr/api/shop';
const OFFERS_URL = `${SHOP_API}/offers`;
const CHECKOUT_URL = `${SHOP_API}/checkout`;
const PLAYER_URL = `${SHOP_API}/players/`;
const IMAGE_ORIGIN = 'https://karamon.fr/';
const PORTAL_ORIGINS = ['https://karamon.fr/', 'https://billing.stripe.com/'];
const SHOP_TERMS_VERSION = '2026-10-17';
const HTTP_TOO_MANY_REQUESTS = 429;
const OFFER_ID_MAX_LENGTH = 128;

const SIGNED_OUT = 'Connecte-toi pour acheter.';
const CHECKOUT_ALREADY_OPEN = 'Un paiement est déjà ouvert.';
const SHOP_UNREACHABLE = 'Impossible de joindre la boutique. Vérifie ta connexion puis réessaie.';
const CHECKOUT_PAGE_FAILED = "La page de paiement n'a pas pu s'ouvrir. Vérifie ta connexion puis réessaie.";
const DEFAULT_ERROR = 'Une erreur est survenue. Réessaie dans un instant.';

const API_ERROR_MESSAGES: Record<string, string> = {
  invalid_username: "Ton pseudo Minecraft n'est pas accepté par la boutique.",
  unknown_player:
    "La boutique ne connaît pas encore ce compte. Connecte-toi une première fois au serveur avec ce pseudo, puis réessaie.",
  unknown_offer: "Cette offre n'existe plus. Rouvre la boutique pour voir les offres à jour.",
  player_lookup_failed: 'La vérification de ton compte a échoué. Réessaie dans un instant.',
  checkout_failed: "Le paiement n'a pas pu démarrer. Réessaie dans un instant.",
  catalog_unavailable: 'La boutique est momentanément indisponible.',
  shop_disabled: 'La boutique ouvre bientôt.',
  terms_not_accepted: 'Coche la case des conditions de vente pour continuer.',
  terms_outdated: 'Les conditions de vente ont changé. Mets à jour le launcher pour accepter la nouvelle version.',
  player_changed: 'Ce pseudo a changé de propriétaire entre-temps. Reconnecte-toi puis réessaie.',
  rate_limited: 'Trop de tentatives. Réessaie dans quelques minutes.',
};

interface RawOffer {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  koins?: unknown;
  bonus?: unknown;
  unit_amount?: unknown;
  currency?: unknown;
  rank?: unknown;
  tax_exclusive?: unknown;
  features?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
const offerKind = (value: unknown): ShopOfferKind => (value === 'subscription' ? 'subscription' : 'pack');

function portalUrl(value: unknown): string | null {
  const url = text(value);
  return PORTAL_ORIGINS.some((origin) => url.startsWith(origin)) ? url : null;
}

export function parseOffers(raw: unknown): ShopCatalog {
  const payload = raw as { offers?: unknown; portal_url?: unknown } | null;
  const list = payload?.offers;
  if (!Array.isArray(list)) return { offers: [], portalUrl: null };
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
      kind: offerKind(offer.kind),
      name,
      description: text(offer.description),
      image: image.startsWith(IMAGE_ORIGIN) ? image : '',
      lumis: count(offer.koins),
      bonus: count(offer.bonus),
      priceCents,
      currency: currency.toLowerCase(),
      taxExclusive: offer.tax_exclusive === true,
      features: Array.isArray(offer.features) ? offer.features.map(text).filter((feature) => feature.length > 0) : [],
      rank: count(offer.rank),
    });
  }
  return {
    offers: offers.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...offer }) => offer),
    portalUrl: portalUrl(payload?.portal_url),
  };
}

function shopErrorMessage(code: string): string {
  return API_ERROR_MESSAGES[code] ?? DEFAULT_ERROR;
}

type ApiAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; code: string };

function readApiAnswer(response: HttpResponse): ApiAnswer {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(response.body.toString('utf8'));
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (response.status >= 200 && response.status < 300) return { ok: true, body };
  if (typeof body.error === 'string') return { ok: false, code: body.error };
  return { ok: false, code: response.status === HTTP_TOO_MANY_REQUESTS ? 'rate_limited' : 'unknown' };
}

const failure = (error: string): ShopCheckoutResult => ({ status: 'error', error });

interface ShopPlayer {
  uuid: string;
  username: string;
}

export interface ShopOptions {
  http: Pick<HttpClient, 'getJson' | 'get' | 'postJson'>;
  activeProfile: () => MinecraftProfile | null;
  openCheckout: (checkoutUrl: string) => Promise<CheckoutOutcome>;
  openExternal: (url: string) => Promise<void>;
}

export class Shop {
  private lastPortalUrl: string | null = null;
  private checkoutOpen = false;
  private readonly options: ShopOptions;

  constructor(options: ShopOptions) {
    this.options = options;
  }

  async catalog(): Promise<ShopCatalog> {
    try {
      const catalog = parseOffers(await this.options.http.getJson<unknown>(OFFERS_URL));
      this.lastPortalUrl = catalog.portalUrl;
      return catalog;
    } catch {
      return { offers: [], portalUrl: null };
    }
  }

  async openPortal(): Promise<void> {
    const url = this.lastPortalUrl ?? (await this.catalog()).portalUrl;
    if (url) await this.options.openExternal(url);
  }

  async checkout(offerId: string): Promise<ShopCheckoutResult> {
    if (offerId.trim() === '' || offerId.length > OFFER_ID_MAX_LENGTH) return failure(shopErrorMessage('unknown_offer'));
    const profile = this.options.activeProfile();
    if (!profile) return failure(SIGNED_OUT);
    if (this.checkoutOpen) return failure(CHECKOUT_ALREADY_OPEN);
    this.checkoutOpen = true;
    try {
      return await this.runCheckout(offerId, profile.name);
    } catch {
      return failure(SHOP_UNREACHABLE);
    } finally {
      this.checkoutOpen = false;
    }
  }

  private async runCheckout(offerId: string, username: string): Promise<ShopCheckoutResult> {
    const lookup = readApiAnswer(await this.options.http.get(PLAYER_URL + encodeURIComponent(username)));
    if (!lookup.ok) return failure(shopErrorMessage(lookup.code));
    const player: ShopPlayer = { uuid: text(lookup.body.uuid), username: text(lookup.body.username) };
    if (!player.uuid || !player.username) return failure(shopErrorMessage('player_lookup_failed'));

    const started = readApiAnswer(
      await this.options.http.postJson(CHECKOUT_URL, {
        offer_id: offerId,
        player_uuid: player.uuid,
        username: player.username,
        accept_terms: true,
        terms_version: SHOP_TERMS_VERSION,
      }),
    );
    if (!started.ok) return failure(shopErrorMessage(started.code));
    const checkoutUrl = text(started.body.url);
    if (!isStripeCheckoutPage(checkoutUrl)) return failure(shopErrorMessage('checkout_failed'));

    const outcome = await this.options.openCheckout(checkoutUrl);
    if (outcome === 'failed') return failure(CHECKOUT_PAGE_FAILED);
    return { status: outcome };
  }
}
