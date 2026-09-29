import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOffers } from './ShopCatalog.ts';

const offer = (over: Record<string, unknown>) => ({
  id: 'karamon_koins_100',
  name: '200 Lumis',
  description: 'Monnaie du menu Karamon.',
  image: 'https://karamon.fr/img/lumis/stripe-1.png',
  koins: 200,
  bonus: 0,
  unit_amount: 199,
  currency: 'eur',
  rank: 1,
  kind: 'pack',
  ...over,
});

test('parseOffers maps the karamon.fr catalogue and sorts it by rank', () => {
  const offers = parseOffers({
    offers: [offer({ id: 'b', name: '880 Lumis', koins: 880, bonus: 80, unit_amount: 799, rank: 2 }), offer({})],
    portal_url: null,
  });
  assert.deepEqual(offers, [
    {
      id: 'karamon_koins_100',
      name: '200 Lumis',
      description: 'Monnaie du menu Karamon.',
      image: 'https://karamon.fr/img/lumis/stripe-1.png',
      lumis: 200,
      bonus: 0,
      priceCents: 199,
      currency: 'eur',
    },
    {
      id: 'b',
      name: '880 Lumis',
      description: 'Monnaie du menu Karamon.',
      image: 'https://karamon.fr/img/lumis/stripe-1.png',
      lumis: 880,
      bonus: 80,
      priceCents: 799,
      currency: 'eur',
    },
  ]);
});

test('offers without a price, a name or a valid currency are dropped', () => {
  const offers = parseOffers({
    offers: [offer({ unit_amount: 0 }), offer({ name: '' }), offer({ currency: 'euro' }), offer({ id: 'ok' })],
  });
  assert.deepEqual(offers.map((o) => o.id), ['ok']);
});

test('an image hosted outside karamon.fr is not shown', () => {
  assert.equal(parseOffers({ offers: [offer({ image: 'https://evil.example/x.png' })] })[0].image, '');
});

test('an error payload yields no offers', () => {
  assert.deepEqual(parseOffers({ error: 'shop_disabled' }), []);
  assert.deepEqual(parseOffers(null), []);
});
