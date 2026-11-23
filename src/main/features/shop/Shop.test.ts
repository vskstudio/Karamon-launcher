import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MinecraftProfile } from '../auth/MinecraftProfile.ts';
import type { HttpResponse } from '../../shared/HttpClient.ts';
import { parseOffers, Shop } from './Shop.ts';
import type { CheckoutOutcome } from './CheckoutWindow.ts';

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

test('parseOffers maps the karamon.fr catalogue, sorts it by rank, keeps the billing portal and the Pass perks and tax mode', () => {
  const catalog = parseOffers({
    offers: [
      offer({
        id: 'pass',
        name: 'Pass Lumineux',
        kind: 'subscription',
        koins: 600,
        unit_amount: 500,
        tax_exclusive: true,
        features: ['600 Lumis à chaque mois payé', '', 42, '/pc : ton PC à distance'],
        rank: 7,
      }),
      offer({ id: 'b', name: '880 Lumis', koins: 880, bonus: 80, unit_amount: 799, rank: 2 }),
      offer({}),
    ],
    portal_url: 'https://billing.stripe.com/p/login/abc',
  });
  assert.deepEqual(catalog, {
    offers: [
      {
        id: 'karamon_koins_100',
        kind: 'pack',
        name: '200 Lumis',
        description: 'Monnaie du menu Karamon.',
        image: 'https://karamon.fr/img/lumis/stripe-1.png',
        lumis: 200,
        bonus: 0,
        priceCents: 199,
        currency: 'eur',
        taxExclusive: false,
        features: [],
      },
      {
        id: 'b',
        kind: 'pack',
        name: '880 Lumis',
        description: 'Monnaie du menu Karamon.',
        image: 'https://karamon.fr/img/lumis/stripe-1.png',
        lumis: 880,
        bonus: 80,
        priceCents: 799,
        currency: 'eur',
        taxExclusive: false,
        features: [],
      },
      {
        id: 'pass',
        kind: 'subscription',
        name: 'Pass Lumineux',
        description: 'Monnaie du menu Karamon.',
        image: 'https://karamon.fr/img/lumis/stripe-1.png',
        lumis: 600,
        bonus: 0,
        priceCents: 500,
        currency: 'eur',
        taxExclusive: true,
        features: ['600 Lumis à chaque mois payé', '/pc : ton PC à distance'],
      },
    ],
    portalUrl: 'https://billing.stripe.com/p/login/abc',
  });
});

test('an offer without a kind is a pack', () => {
  const { kind: _kind, ...withoutKind } = offer({});
  assert.equal(parseOffers({ offers: [withoutKind] }).offers[0].kind, 'pack');
});

test('offers without a price, a name or a valid currency are dropped', () => {
  const { offers } = parseOffers({
    offers: [offer({ unit_amount: 0 }), offer({ name: '' }), offer({ currency: 'euro' }), offer({ id: 'ok' })],
  });
  assert.deepEqual(offers.map((o) => o.id), ['ok']);
});

test('an image hosted outside karamon.fr is not shown', () => {
  assert.equal(parseOffers({ offers: [offer({ image: 'https://evil.example/x.png' })] }).offers[0].image, '');
});

test('a portal outside karamon.fr and Stripe billing is not offered', () => {
  for (const portal_url of ['https://evil.example/portal', 'http://billing.stripe.com/p/login/abc', 'https://billing.stripe.com.evil.example/', 42]) {
    assert.equal(parseOffers({ offers: [offer({})], portal_url }).portalUrl, null, String(portal_url));
  }
  assert.equal(parseOffers({ offers: [], portal_url: 'https://karamon.fr/compte' }).portalUrl, 'https://karamon.fr/compte');
});

test('an error payload yields an empty catalogue', () => {
  assert.deepEqual(parseOffers({ error: 'shop_disabled' }), { offers: [], portalUrl: null });
  assert.deepEqual(parseOffers(null), { offers: [], portalUrl: null });
});

const STRIPE_PAGE = 'https://checkout.stripe.com/c/pay/cs_live_abc';
const respond = (status: number, body: unknown): HttpResponse => ({ status, body: Buffer.from(JSON.stringify(body)) });

interface FakeShopServer {
  lookup?: HttpResponse;
  checkout?: HttpResponse;
  outcome?: CheckoutOutcome;
  profile?: MinecraftProfile | null;
  paymentWindow?: () => Promise<CheckoutOutcome>;
}

function shopAgainst(server: FakeShopServer) {
  const lookups: string[] = [];
  const posted: unknown[] = [];
  const opened: string[] = [];
  const shop = new Shop({
    http: {
      getJson: async () => {
        throw new Error('catalogue not expected');
      },
      get: async (url: string) => {
        lookups.push(url);
        return server.lookup ?? respond(200, { uuid: '6a1c7d2e-0000-3000-8000-000000000001', username: 'Pikachu_Fan' });
      },
      postJson: async (_url: string, payload: unknown) => {
        posted.push(payload);
        return server.checkout ?? respond(200, { url: STRIPE_PAGE });
      },
    },
    activeProfile: () =>
      server.profile === undefined ? { id: 'ffffffff-ffff-3fff-bfff-ffffffffffff', name: 'pikachu_fan', kind: 'offline' } : server.profile,
    openCheckout: async (url) => {
      opened.push(url);
      return server.paymentWindow ? server.paymentWindow() : server.outcome ?? 'paid';
    },
    openExternal: async () => undefined,
  });
  return { shop, lookups, posted, opened };
}

test('checkout pays for the account the shop resolves, with the terms accepted', async () => {
  const { shop, lookups, posted, opened } = shopAgainst({});
  assert.deepEqual(await shop.checkout('karamon_koins_300'), { status: 'paid' });
  assert.deepEqual(lookups, ['https://karamon.fr/api/shop/players/pikachu_fan']);
  assert.equal(posted.length, 1);
  const body = posted[0] as Record<string, unknown>;
  assert.equal(body.offer_id, 'karamon_koins_300');
  assert.equal(body.player_uuid, '6a1c7d2e-0000-3000-8000-000000000001');
  assert.equal(body.username, 'Pikachu_Fan');
  assert.equal(body.accept_terms, true);
  assert.match(String(body.terms_version), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(opened, [STRIPE_PAGE]);
});

test('checkout refuses a signed-out launcher without calling the shop', async () => {
  const { shop, lookups, posted } = shopAgainst({ profile: null });
  await assert.rejects(shop.checkout('karamon_koins_100'), { message: 'Connecte-toi pour acheter.' });
  assert.deepEqual(lookups, []);
  assert.deepEqual(posted, []);
});

test('an empty or oversized offer id is refused before any request', async () => {
  for (const offerId of ['', '   ', 'x'.repeat(129)]) {
    const { shop, lookups, posted } = shopAgainst({});
    await assert.rejects(shop.checkout(offerId), /Cette offre n'existe plus/);
    assert.deepEqual(lookups, []);
    assert.deepEqual(posted, []);
  }
});

test('closing the payment window cancels the purchase', async () => {
  const { shop } = shopAgainst({ outcome: 'cancelled' });
  assert.deepEqual(await shop.checkout('karamon_koins_100'), { status: 'cancelled' });
});

test('API refusals are explained in French', async () => {
  const cases: [FakeShopServer, RegExp][] = [
    [{ checkout: respond(409, { error: 'player_changed' }) }, /changé de propriétaire/],
    [{ checkout: { status: 429, body: Buffer.from('Too Many Requests') } }, /Trop de tentatives/],
    [{ lookup: respond(404, { error: 'unknown_player' }) }, /Connecte-toi une première fois au serveur/],
    [{ checkout: respond(502, { error: 'something_new' }) }, /Une erreur est survenue/],
  ];
  for (const [server, message] of cases) {
    const { shop, opened } = shopAgainst(server);
    await assert.rejects(shop.checkout('karamon_koins_100'), message);
    assert.deepEqual(opened, []);
  }
});

test('a checkout URL that is not a Stripe Checkout page is never opened', async () => {
  for (const url of ['https://evil.example/pay', 'http://checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com.evil.example/']) {
    const { shop, opened } = shopAgainst({ checkout: respond(200, { url }) });
    await assert.rejects(shop.checkout('karamon_koins_100'), /Le paiement n'a pas pu démarrer/, url);
    assert.deepEqual(opened, [], url);
  }
});

test('a second purchase cannot start while the payment window is open', async () => {
  let finishFirst: (outcome: CheckoutOutcome) => void = () => undefined;
  const { shop, posted } = shopAgainst({ paymentWindow: () => new Promise((resolve) => (finishFirst = resolve)) });
  const first = shop.checkout('karamon_koins_100');
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(shop.checkout('karamon_koins_300'), /Un paiement est déjà ouvert/);
  assert.equal(posted.length, 1);
  finishFirst('paid');
  assert.deepEqual(await first, { status: 'paid' });
});
