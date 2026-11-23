import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCheckoutUrl, type CheckoutNavigation } from './CheckoutNavigation.ts';

test('the payment window follows Stripe and karamon.fr and stops on the shop return URLs', () => {
  const cases: [string, CheckoutNavigation][] = [
    ['https://karamon.fr/boutique?achat=ok&type=koins', 'paid'],
    ['https://karamon.fr/boutique?achat=ok&type=abonnement', 'paid'],
    ['https://karamon.fr/boutique?achat=annule', 'cancelled'],
    ['https://checkout.stripe.com/c/pay/cs_live_abc#fid', 'allowed'],
    ['https://hooks.stripe.com/3d_secure_2/hosted', 'allowed'],
    ['https://stripe.com/fr/legal', 'allowed'],
    ['https://karamon.fr/cgv', 'allowed'],
    ['http://karamon.fr/boutique?achat=ok', 'blocked'],
    ['https://karamon.fr:8443/boutique?achat=ok', 'blocked'],
    ['https://evil.example/?next=https://checkout.stripe.com', 'blocked'],
    ['https://stripe.com.evil.example/', 'blocked'],
    ['https://evilstripe.com/', 'blocked'],
    ['https://karamon.fr.evil.example/boutique?achat=ok', 'blocked'],
    ['javascript:alert(1)', 'blocked'],
    ['file:///etc/passwd', 'blocked'],
    ['not a url', 'blocked'],
  ];
  for (const [url, expected] of cases) assert.equal(classifyCheckoutUrl(url), expected, url);
});
