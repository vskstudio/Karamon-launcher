import type { ShopOffer } from '../../../ipc/contract.ts';
import { formatPrice } from '../../util/format.ts';

const FRENCH_VAT_RATE = 0.2;

export interface OfferPricing {
  price: string;
  cadence: string;
  note: string | null;
}

function frenchPriceCents(offer: ShopOffer): number {
  if (!offer.taxExclusive) return offer.priceCents;
  return Math.round(offer.priceCents * (1 + FRENCH_VAT_RATE));
}

export function offerPricing(offer: ShopOffer): OfferPricing {
  const monthly = offer.kind === 'subscription';
  const cadence = monthly ? ' / mois' : '';
  const price = formatPrice(frenchPriceCents(offer), offer.currency);
  if (!offer.taxExclusive) {
    return { price, cadence, note: monthly ? 'Résiliable à tout moment.' : null };
  }
  const beforeTax = formatPrice(offer.priceCents, offer.currency);
  return {
    price,
    cadence,
    note: `${beforeTax} HT${cadence}, soit ${price} TTC en France. TVA ajoutée au paiement selon ton pays, le total TTC s’affiche avant de valider.`,
  };
}
