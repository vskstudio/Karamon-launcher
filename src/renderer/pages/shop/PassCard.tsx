import type { ShopOffer } from '../../../ipc/contract';
import passArt from '../../assets/art/offer-pass.webp';
import { openPortal } from '../../state/shop';
import { Button, PixelIcon } from '../../ui';
import { offerPricing } from './pricing';

interface PassCardProps {
  offer: ShopOffer;
  canManage: boolean;
  disabled: boolean;
  onSubscribe: (offer: ShopOffer) => void;
}

export function PassCard({ offer, canManage, disabled, onSubscribe }: PassCardProps) {
  const pricing = offerPricing(offer);
  return (
    <div class="shop-pass-frame">
    <section class="shop-pass surface surface--accent" aria-labelledby="shop-pass-title">
      <div class="shop-pass__glow" aria-hidden="true" />
      <img class="shop-pass__art float pixelated" src={passArt} alt="" draggable={false} />
      <div class="shop-pass__body">
        <p class="ui-eyebrow shop-pass__eyebrow">Abonnement mensuel, sans engagement</p>
        <h2 id="shop-pass-title" class="shop-pass__title">
          {offer.name}
        </h2>
        <p class="shop-pass__price num">
          {pricing.price}
          {pricing.cadence}
        </p>
        {offer.features.length > 0 ? (
          <ul class="shop-pass__perks">
            {offer.features.map((perk) => (
              <li key={perk}>
                <PixelIcon name="sparkle" size={14} />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="shop-pass__description">{offer.description}</p>
        )}
      </div>
      <div class="shop-pass__actions">
        <Button variant="primary" size="lg" full disabled={disabled} onClick={() => onSubscribe(offer)}>
          S’abonner
        </Button>
        {pricing.note ? <p class="shop-pass__note">{pricing.note}</p> : null}
        {canManage ? (
          <Button variant="ghost" size="sm" glyph="external" onClick={() => void openPortal()}>
            Gérer ou résilier mon abonnement
          </Button>
        ) : null}
      </div>
    </section>
    </div>
  );
}
