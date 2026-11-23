import { computed, signal } from '@preact/signals';
import type { ShopCatalog, ShopCheckoutResult, ShopOffer } from '../../ipc/contract';
import { toast } from '../ui';
import { formatNumber } from '../util/format';
import { api } from './api';
import { log } from './console';
import type { Loadable } from './loadable';

export const catalog = signal<Loadable<ShopCatalog>>({ status: 'idle' });
export const checkoutPending = signal(false);

const readyCatalog = computed(() => (catalog.value.status === 'ready' ? catalog.value.data : null));

export const packOffers = computed(() => readyCatalog.value?.offers.filter((offer) => offer.kind === 'pack') ?? []);
export const passOffer = computed(() => readyCatalog.value?.offers.find((offer) => offer.kind === 'subscription') ?? null);
export const portalUrl = computed(() => readyCatalog.value?.portalUrl ?? null);

export const bestOfferId = computed(() => {
  let best: ShopOffer | null = null;
  for (const offer of packOffers.value) {
    if (bonusPercent(offer) > (best ? bonusPercent(best) : 0)) best = offer;
  }
  return best?.id ?? null;
});

export function baseLumis(offer: ShopOffer): number {
  return offer.lumis - offer.bonus;
}

export function bonusPercent(offer: ShopOffer): number {
  const base = baseLumis(offer);
  return base > 0 && offer.bonus > 0 ? Math.round((offer.bonus / base) * 100) : 0;
}

export async function loadCatalog(force = false): Promise<void> {
  if (!force && (catalog.value.status === 'ready' || catalog.value.status === 'loading')) return;
  catalog.value = { status: 'loading' };
  try {
    catalog.value = { status: 'ready', data: await api.shopCatalog() };
  } catch {
    catalog.value = { status: 'error' };
  }
}

export async function checkout(offer: ShopOffer, playerName: string): Promise<ShopCheckoutResult> {
  if (checkoutPending.value) return { status: 'error', error: 'Un paiement est déjà en cours.' };
  checkoutPending.value = true;
  log(`Boutique : paiement de « ${offer.name} » ouvert pour ${playerName}.`, 'info');
  let result: ShopCheckoutResult;
  try {
    result = await api.shopCheckout(offer.id);
  } catch (error) {
    result = { status: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally {
    checkoutPending.value = false;
  }
  reportCheckout(offer, playerName, result);
  return result;
}

function reportCheckout(offer: ShopOffer, playerName: string, result: ShopCheckoutResult): void {
  if (result.status === 'paid') {
    const message =
      offer.lumis > 0
        ? `Paiement confirmé : ${formatNumber(offer.lumis)} Lumis en route vers ${playerName}.`
        : `Paiement confirmé : ${offer.name} activé sur ${playerName}.`;
    log(message, 'success');
    toast(message, 'success');
    return;
  }
  if (result.status === 'cancelled') {
    log('Boutique : paiement annulé.', 'info');
    return;
  }
  log(`Boutique : échec du paiement (${result.error}).`, 'error');
}

export async function openPortal(): Promise<void> {
  try {
    await api.shopPortal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Boutique : impossible d’ouvrir la gestion d’abonnement (${message}).`, 'error');
    toast('Impossible d’ouvrir la gestion d’abonnement.', 'error');
  }
}
