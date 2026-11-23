import { useEffect, useRef, useState } from 'preact/hooks';
import type { ShopOffer } from '../../../ipc/contract';
import lumisArt from '../../assets/art/lumis.webp';
import passArt from '../../assets/art/offer-pass.webp';
import { api } from '../../state/api';
import { links } from '../../state/links';
import { activeAccount } from '../../state/session';
import { checkout } from '../../state/shop';
import { Button, Checkbox, Dialog, Glyph, Spinner } from '../../ui';
import { formatNumber } from '../../util/format';
import { OfferArt } from './OfferArt';
import { packSubtitle } from './PackCard';
import { offerPricing } from './pricing';

type Step =
  | { kind: 'recap'; cancelled: boolean }
  | { kind: 'waiting' }
  | { kind: 'paid'; playerName: string }
  | { kind: 'error'; message: string };

interface PurchaseDialogProps {
  offer: ShopOffer;
  onClose: () => void;
}

function OfferHero({ offer }: { offer: ShopOffer }) {
  if (offer.kind === 'subscription') return <img class="shop-dialog__hero float pixelated" src={passArt} alt="" draggable={false} />;
  return <OfferArt class="shop-dialog__hero float" src={offer.image} fallback={lumisArt} />;
}

function recapTitle(offer: ShopOffer): string {
  return offer.kind === 'subscription' ? offer.name : `${formatNumber(offer.lumis)} Lumis`;
}

function recapSubtitle(offer: ShopOffer): string {
  if (offer.kind === 'subscription') return 'Abonnement mensuel, sans engagement';
  return packSubtitle(offer, false);
}

function paidTitle(offer: ShopOffer): string {
  if (offer.kind === 'subscription') return 'Bienvenue dans le Pass !';
  return `+${formatNumber(offer.lumis)} Lumis`;
}

function paidText(offer: ShopOffer, playerName: string): string {
  if (offer.kind === 'subscription') {
    return offer.lumis > 0
      ? `Tes ${formatNumber(offer.lumis)} Lumis et les avantages du Pass arrivent en jeu sur ${playerName} dans quelques secondes.`
      : `Les avantages du Pass arrivent en jeu sur ${playerName} dans quelques secondes.`;
  }
  return `Ils arrivent en jeu sur ${playerName} dans quelques secondes.`;
}

export function PurchaseDialog({ offer, onClose }: PurchaseDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'recap', cancelled: false });
  const [accepted, setAccepted] = useState(false);
  const account = activeAccount.value;
  const isPass = offer.kind === 'subscription';
  const pricing = offerPricing(offer);
  const price = `${pricing.price}${pricing.cadence}`;
  const contentRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    contentRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [step.kind]);

  const pay = async () => {
    if (!account || !accepted) return;
    setStep({ kind: 'waiting' });
    const result = await checkout(offer, account.name);
    if (result.status === 'paid') setStep({ kind: 'paid', playerName: account.name });
    else if (result.status === 'cancelled') setStep({ kind: 'recap', cancelled: true });
    else setStep({ kind: 'error', message: result.error });
  };

  if (step.kind === 'waiting') {
    return (
      <Dialog open onClose={onClose} title="Termine le paiement" hero={<OfferHero offer={offer} />} dismissible={false}>
        <div ref={contentRef} class="shop-dialog__center">
          <Spinner size={32} label="Paiement en cours" />
          <p class="shop-dialog__text">
            Termine le paiement dans la fenêtre sécurisée. Le launcher attend la confirmation de Stripe.
          </p>
        </div>
      </Dialog>
    );
  }

  if (step.kind === 'paid') {
    return (
      <Dialog
        open
        onClose={onClose}
        title={paidTitle(offer)}
        hero={<OfferHero offer={offer} />}
        footer={
          <Button variant="primary" full onClick={onClose}>
            Génial
          </Button>
        }
      >
        <div ref={contentRef} class="shop-dialog__center">
          <span class="shop-dialog__success" aria-hidden="true">
            <Glyph name="check" size={24} strokeWidth={3} />
          </span>
          <p class="shop-dialog__text" role="status">
            {paidText(offer, step.playerName)}
          </p>
        </div>
      </Dialog>
    );
  }

  if (step.kind === 'error') {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Paiement impossible"
        hero={<OfferHero offer={offer} />}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            <Button variant="primary" glyph="refresh" onClick={() => setStep({ kind: 'recap', cancelled: false })}>
              Réessayer
            </Button>
          </>
        }
      >
        <div ref={contentRef} class="shop-dialog__error" role="alert">
          <Glyph name="warning" size={16} />
          <span>{step.message || 'Le paiement n’a pas pu aboutir. Rien n’a été débité.'}</span>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={recapTitle(offer)} description={recapSubtitle(offer) || undefined} hero={<OfferHero offer={offer} />}>
      <div ref={contentRef} class="shop-dialog__content">
        <dl class="shop-recap surface surface--inset">
          <div class="shop-recap__row">
            <dt>Livré sur</dt>
            <dd class="shop-recap__player">{account ? account.name : 'Aucun compte connecté'}</dd>
          </div>
          <div class="shop-recap__row">
            <dt>Total</dt>
            <dd class="shop-recap__total num">{price}</dd>
          </div>
        </dl>
        <div class="shop-dialog__terms">
          <Checkbox checked={accepted} onChange={setAccepted}>
            J’accepte les conditions générales de vente. Je demande la livraison immédiate de mon achat et je renonce à mon
            droit de rétractation dès cette livraison.
          </Checkbox>
          <Button variant="ghost" size="sm" glyph="external" class="shop-dialog__terms-link" onClick={() => void api.openExternal(links.terms)}>
            Lire les conditions de vente
          </Button>
        </div>
        {step.cancelled ? (
          <p class="shop-dialog__notice" role="status">
            Paiement annulé, rien n’a été débité. Tu peux réessayer quand tu veux.
          </p>
        ) : null}
        <Button variant="primary" size="lg" full disabled={!account || !accepted} onClick={() => void pay()}>
          {isPass ? `S’abonner, ${price}` : `Payer ${price}`}
        </Button>
        <p class="shop-dialog__fineprint">
          Le paiement s’ouvre dans une fenêtre sécurisée Stripe. Tu peux payer par carte, Apple Pay ou Google Pay.
        </p>
      </div>
    </Dialog>
  );
}
