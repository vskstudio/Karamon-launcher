import { openAccountsDialog } from '../../state/accounts';
import { accounts, activeAccount } from '../../state/session';
import { skinUrlOf } from '../../state/skins';
import { Button, EmptyState, Page } from '../../ui';
import { MicrosoftSkinView } from './MicrosoftSkinView';
import { OfflineSkinEditor } from './OfflineSkinEditor';
import { useSkinImage } from './useSkinImage';
import './skins.css';

export function SkinsPage({ param }: { param: string | null }) {
  const profile = accounts.value.find((account) => account.id === param) ?? activeAccount.value;
  const { image, loading } = useSkinImage(profile ? skinUrlOf(profile) : null);

  if (!profile) {
    return (
      <Page label="Skins">
        <EmptyState
          pixel="players"
          title="Aucun compte connecté"
          actions={
            <Button variant="primary" onClick={() => openAccountsDialog()}>
              Se connecter
            </Button>
          }
        >
          Connecte-toi pour voir ton skin et, avec un compte sans licence, en choisir un nouveau.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page label="Skins" scroll={false} padded={false} class="skins">
      {profile.kind === 'offline' ? (
        <OfflineSkinEditor key={profile.id} profile={profile} current={image} currentLoading={loading} />
      ) : (
        <MicrosoftSkinView profile={profile} current={image} currentLoading={loading} />
      )}
    </Page>
  );
}
