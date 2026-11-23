import { KARAMON } from '../../../shared/Karamon.ts';

export type CheckoutNavigation = 'paid' | 'cancelled' | 'allowed' | 'blocked';

const SHOP_HOST = KARAMON.websiteHost;
const STRIPE_HOST = 'stripe.com';
const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';
const PURCHASE_OUTCOME_PARAM = 'achat';

function parseSecureUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  return url;
}

export function classifyCheckoutUrl(raw: string): CheckoutNavigation {
  const url = parseSecureUrl(raw);
  if (!url) return 'blocked';
  const host = url.hostname.toLowerCase();
  if (host === SHOP_HOST) {
    const outcome = url.searchParams.get(PURCHASE_OUTCOME_PARAM);
    if (outcome === 'ok') return 'paid';
    if (outcome === 'annule') return 'cancelled';
    return 'allowed';
  }
  if (host === STRIPE_HOST || host.endsWith(`.${STRIPE_HOST}`)) return 'allowed';
  return 'blocked';
}

export function isStripeCheckoutPage(raw: string): boolean {
  return parseSecureUrl(raw)?.hostname.toLowerCase() === STRIPE_CHECKOUT_HOST;
}
