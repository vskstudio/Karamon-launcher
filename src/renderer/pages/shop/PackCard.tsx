import { useId } from 'preact/hooks';
import type { ShopOffer } from '../../../ipc/contract';
import lumisArt from '../../assets/art/lumis.webp';
import { bonusPercent } from '../../state/shop';
import { Badge, cx, PixelIcon } from '../../ui';
import { formatNumber } from '../../util/format';
import { offerPricing } from './pricing';
import { OfferArt } from './OfferArt';

interface PackCardProps {
  offer: ShopOffer;
  first: boolean;
  best: boolean;
  disabled: boolean;
  onSelect: (offer: ShopOffer) => void;
}

export function packSubtitle(offer: ShopOffer, first: boolean): string {
  if (offer.bonus > 0) return `dont ${formatNumber(offer.bonus)} offerts`;
  return first ? 'Pour commencer' : '';
}

export function PackCard({ offer, first, best, disabled, onSelect }: PackCardProps) {
  const detailsId = useId();
  const percent = bonusPercent(offer);
  const subtitle = packSubtitle(offer, first);
  return (
    <button
      type="button"
      class={cx('shop-pack', 'surface', best && 'surface--accent', best && 'is-best')}
      aria-label={`${formatNumber(offer.lumis)} Lumis`}
      aria-describedby={detailsId}
      disabled={disabled}
      onClick={() => onSelect(offer)}
    >
      {best ? (
        <Badge tone="gold" class="shop-pack__best">
          MEILLEURE OFFRE
        </Badge>
      ) : null}
      {percent > 0 ? (
        <Badge tone="lumis" class="shop-pack__bonus">
          +{percent} %
        </Badge>
      ) : null}
      <OfferArt class="shop-pack__art" src={offer.image} fallback={lumisArt} />
      <span class="shop-pack__amount num">
        <PixelIcon name="lumis" size={18} />
        {formatNumber(offer.lumis)}
      </span>
      <span id={detailsId} class="shop-pack__details">
        <span class="shop-pack__subtitle">{subtitle}</span>
        <span class="shop-pack__price num">{offerPricing(offer).price}</span>
        {best ? <span class="visually-hidden">Meilleure offre</span> : null}
      </span>
    </button>
  );
}
