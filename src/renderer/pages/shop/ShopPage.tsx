import { useEffect, useState } from 'preact/hooks';
import type { ShopOffer } from '../../../ipc/contract';
import { api } from '../../state/api';
import { links } from '../../state/links';
import { KARAMON } from '../../../shared/Karamon';
import { activeAccount, openAccounts } from '../../state/session';
import { bestOfferId, catalog, checkoutPending, loadCatalog, packOffers, passOffer, portalUrl } from '../../state/shop';
import { Banner, Button, EmptyState, Page, PageHeader } from '../../ui';
import { PackCard } from './PackCard';
import { PassCard } from './PassCard';
import { PurchaseDialog } from './PurchaseDialog';
import './shop.css';

const PASS_PARAM = 'pass';
const SKELETON_PACKS = 6;

const steps = [
  { title: 'Choisis ton pack', text: 'Ton compte connecté est déjà rempli, pas de pseudo à retaper.' },
  { title: 'Paie en sécurité', text: 'Par Stripe, en carte, Apple Pay ou Google Pay. Le launcher ne voit jamais ta carte.' },
  { title: 'Joue', text: 'Les Lumis arrivent en jeu en quelques secondes, même si tu es connecté.' },
] as const;

function openSiteShop(): void {
  void api.openExternal(links.shop);
}

function HeaderDescription() {
  const account = activeAccount.value;
  if (!account) return <>Connecte un compte pour acheter des Lumis depuis le launcher.</>;
  return (
    <>
      Livré sur <strong class="shop__player">{account.name}</strong> en quelques secondes, même si tu es en jeu.
    </>
  );
}

function SectionDivider({ id, children }: { id: string; children: string }) {
  return (
    <div class="shop__divider">
      <span class="shop__divider-line" aria-hidden="true" />
      <h2 id={id} class="ui-eyebrow shop__divider-title">
        {children}
      </h2>
      <span class="shop__divider-line shop__divider-line--end" aria-hidden="true" />
    </div>
  );
}

function HowItWorks() {
  return (
    <ol class="shop__steps" aria-label="Comment ça marche">
      {steps.map((step, index) => (
        <li key={step.title} class="shop__step surface">
          <span class="shop__step-index num" aria-hidden="true">
            {index + 1}
          </span>
          <span class="shop__step-text">
            <strong>{step.title}</strong>
            <span>{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function LoadingCatalog() {
  return (
    <div class="shop__loading" aria-busy="true" aria-label="Chargement de la boutique">
      <div class="shop__skeleton shop__skeleton--pass" />
      <div class="shop__packs">
        {Array.from({ length: SKELETON_PACKS }, (_, index) => (
          <div key={index} class="shop__skeleton shop__skeleton--pack" />
        ))}
      </div>
    </div>
  );
}

function UnavailableCatalog({ failed }: { failed: boolean }) {
  return (
    <EmptyState
      pixel="shop"
      title={failed ? 'La boutique est momentanément indisponible' : 'Aucune offre pour le moment'}
      actions={
        <>
          <Button glyph="refresh" onClick={() => void loadCatalog(true)}>
            Réessayer
          </Button>
          <Button variant="ghost" glyph="external" onClick={openSiteShop}>
            Ouvrir la boutique du site
          </Button>
        </>
      }
    >
      {failed ? `Vérifie ta connexion, ou retrouve-la directement sur ${KARAMON.websiteHost}.` : `Reviens un peu plus tard, ou passe par ${KARAMON.websiteHost}.`}
    </EmptyState>
  );
}

function Catalog({ onSelect }: { onSelect: (offer: ShopOffer) => void }) {
  const pass = passOffer.value;
  const packs = packOffers.value;
  const purchasesLocked = !activeAccount.value || checkoutPending.value;
  if (!pass && packs.length === 0) return <UnavailableCatalog failed={false} />;
  return (
    <>
      {pass ? <PassCard offer={pass} canManage={Boolean(portalUrl.value)} disabled={purchasesLocked} onSubscribe={onSelect} /> : null}
      {packs.length > 0 ? (
        <section class="shop__section" aria-labelledby="shop-packs-title">
          <SectionDivider id="shop-packs-title">Packs de Lumis</SectionDivider>
          <div class="shop__packs">
            {packs.map((offer, index) => (
              <PackCard
                key={offer.id}
                offer={offer}
                first={index === 0}
                best={offer.id === bestOfferId.value}
                disabled={purchasesLocked}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ) : null}
      <HowItWorks />
    </>
  );
}

export function ShopPage({ param }: { param: string | null }) {
  const [selected, setSelected] = useState<ShopOffer | null>(null);
  const state = catalog.value;
  const account = activeAccount.value;

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!param || state.status !== 'ready' || !account) return;
    const target = state.data.offers.find((offer) => offer.id === param || (param === PASS_PARAM && offer.kind === 'subscription'));
    if (target) setSelected(target);
  }, [param, state.status]);

  return (
    <Page label="Boutique" class="shop">
      <div class="shop__halo" aria-hidden="true" />
      <PageHeader
        eyebrow="Boutique"
        title="Lumis et avantages"
        description={<HeaderDescription />}
        actions={
          <Button variant="ghost" size="sm" glyph="external" onClick={openSiteShop}>
            {KARAMON.shopUrl.replace(/^https:\/\//, '')}
          </Button>
        }
      />
      {account ? null : (
        <Banner
          pixel="profile"
          actions={
            <Button variant="primary" size="sm" onClick={openAccounts}>
              Se connecter
            </Button>
          }
        >
          Les Lumis sont livrés sur ton compte Minecraft. Connecte-toi pour pouvoir acheter.
        </Banner>
      )}
      {state.status === 'ready' ? (
        <Catalog onSelect={setSelected} />
      ) : state.status === 'error' ? (
        <UnavailableCatalog failed />
      ) : (
        <LoadingCatalog />
      )}
      {selected ? <PurchaseDialog key={selected.id} offer={selected} onClose={() => setSelected(null)} /> : null}
    </Page>
  );
}
