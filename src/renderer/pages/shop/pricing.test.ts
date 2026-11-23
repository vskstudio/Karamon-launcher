import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShopOffer } from '../../../ipc/contract.ts';
import { offerPricing } from './pricing.ts';

const offer = (over: Partial<ShopOffer>): ShopOffer => ({
  id: 'karamon_koins_100',
  kind: 'pack',
  name: '200 Lumis',
  description: '',
  image: '',
  lumis: 200,
  bonus: 0,
  priceCents: 199,
  currency: 'eur',
  taxExclusive: false,
  features: [],
  ...over,
});

const normalizeSpaces = (text: string) => text.replace(/\s/g, ' ');

test('a pack priced with tax included shows its price as is, without a note', () => {
  const pricing = offerPricing(offer({}));
  assert.equal(normalizeSpaces(pricing.price), '1,99 €');
  assert.equal(pricing.cadence, '');
  assert.equal(pricing.note, null);
});

test('the Pass billed before tax shows the French price with tax and explains the price before tax', () => {
  const pricing = offerPricing(offer({ kind: 'subscription', priceCents: 500, taxExclusive: true }));
  assert.equal(normalizeSpaces(pricing.price), '6,00 €');
  assert.equal(pricing.cadence, ' / mois');
  assert.match(normalizeSpaces(pricing.note ?? ''), /^5,00 € HT \/ mois, soit 6,00 € TTC en France\./);
});
