import { useEffect, useId } from 'preact/hooks';
import galaxy from '../../assets/art/backdrop_galaxy.webp';
import pass from '../../assets/art/offer-pass.webp';
import { AccountRow } from '../../features/accounts/AccountRow';
import { accountKindLabel, openAccountsDialog, requestLogout, selectAccount } from '../../state/accounts';
import { navigate } from '../../state/navigation';
import { accounts, activeAccount } from '../../state/session';
import { avatarFallbackOf, skinUrlOf } from '../../state/skins';
import { refreshStats, stats } from '../../state/stats';
import { activeTask, isBusy, loginMicrosoft } from '../../state/tasks';
import { Button, EmptyState, Glyph, Page, Panel, PanelButton, SkinFace, Stat, Tag } from '../../ui';
import { formatDuration, formatNumber, formatRelative, formatShortDate } from '../../util/format';
import './account.css';

function PlayTimeCard() {
  const current = stats.value;
  return (
    <Panel title="Temps de jeu" actions={<span class="account__scope">Sur ce PC</span>} class="account__card">
      {!current ? (
        <p class="account__muted">Chargement…</p>
      ) : current.sessions === 0 ? (
        <p class="account__muted">Pas encore de partie lancée depuis ce launcher.</p>
      ) : (
        <div class="account__stats">
          <Stat label="Au total" value={formatDuration(current.totalPlayMs)} />
          <Stat label="Sessions" value={formatNumber(current.sessions)} />
          <Stat label="Première session" value={current.firstPlayedAt ? formatShortDate(current.firstPlayedAt) : 'Jamais'} />
          <Stat label="Dernière session" value={formatRelative(current.lastPlayedAt)} />
        </div>
      )}
    </Panel>
  );
}

function ShopCard() {
  const textId = useId();
  return (
    <PanelButton onClick={() => navigate('shop')} class="account__shop surface--lumis" label="Ouvrir la boutique" describedBy={textId}>
      <img class="account__shop-art float" src={pass} alt="" width={72} height={63} />
      <span class="account__shop-text">
        <span class="ui-eyebrow account__shop-eyebrow">Pass Karamon et Lumis</span>
        <strong>Ouvrir la boutique</strong>
        <span id={textId}>Recharge tes Lumis ou prends le Pass Karamon, le tout depuis le launcher.</span>
      </span>
      <Glyph name="chevronRight" size={18} class="account__shop-chevron" />
    </PanelButton>
  );
}

function AccountsCard() {
  const active = activeAccount.value;
  const loggingIn = activeTask.value === 'login';
  return (
    <Panel title="Comptes sur ce PC" class="account__card account__card--wide">
      <ul class="account__list" aria-label="Comptes sur ce PC">
        {accounts.value.map((profile) => {
          const isActive = profile.id === active?.id;
          return (
            <AccountRow
              key={profile.id}
              profile={profile}
              active={isActive}
              actions={
                isActive ? (
                  <>
                    <Tag tone="success">Actif</Tag>
                    <Button size="sm" variant="ghost" onClick={() => requestLogout(profile)}>
                      Se déconnecter
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => void selectAccount(profile)}>
                    Utiliser
                  </Button>
                )
              }
            />
          );
        })}
      </ul>
      <div class="account__add">
        <Button size="sm" glyph="plus" loading={loggingIn} disabled={isBusy.value && !loggingIn} onClick={() => void loginMicrosoft()}>
          Ajouter un compte Microsoft
        </Button>
        <Button size="sm" variant="ghost" pixel="profile" onClick={() => openAccountsDialog('offline')}>
          Compte sans licence
        </Button>
      </div>
    </Panel>
  );
}

export function AccountPage() {
  const active = activeAccount.value;

  useEffect(() => {
    void refreshStats();
  }, []);

  if (!active) {
    return (
      <Page label="Compte">
        <EmptyState
          pixel="profile"
          title="Aucun compte connecté"
          actions={
            <Button variant="primary" onClick={() => openAccountsDialog()}>
              Se connecter
            </Button>
          }
        >
          Connecte-toi pour jouer sur Karamon et retrouver ici ton temps de jeu et tes comptes.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page label="Compte" padded={false} class="account">
      <header class="account__hero">
        <img class="account__hero-art pixelated" src={galaxy} alt="" />
        <div class="account__hero-veil" aria-hidden="true" />
        <div class="account__hero-content">
          <SkinFace skinUrl={skinUrlOf(active)} fallbackUrl={avatarFallbackOf(active)} size={84} ring />
          <div class="account__identity">
            <h1 class="account__name">{active.name}</h1>
            <p class="account__kind">{accountKindLabel(active.kind)}</p>
          </div>
          <Button onClick={() => openAccountsDialog()}>Changer de compte</Button>
        </div>
      </header>
      <div class="account__grid">
        <PlayTimeCard />
        <ShopCard />
        <AccountsCard />
      </div>
    </Page>
  );
}
