import type { MinecraftProfile } from '../../../ipc/contract';
import { accountsDialogView, closeAccountsDialog, confirmLogout, logoutRequest, requestLogout, selectAccount } from '../../state/accounts';
import { navigate } from '../../state/navigation';
import { accounts, accountsDialogOpen, activeAccount } from '../../state/session';
import { activeTask, isBusy, loginMicrosoft } from '../../state/tasks';
import { Button, Dialog, Tag } from '../../ui';
import { AccountRow } from './AccountRow';
import { OfflineLoginDialog } from './OfflineLoginDialog';
import './accounts.css';

function startMicrosoftLogin(): void {
  void loginMicrosoft().then((ok) => {
    if (ok) closeAccountsDialog();
  });
}

function ListActions({ profile, isActive }: { profile: MinecraftProfile; isActive: boolean }) {
  const openSkin = () => {
    closeAccountsDialog();
    navigate('skins', profile.id);
  };
  return (
    <>
      {profile.kind === 'offline' ? (
        <Button size="sm" variant="ghost" pixel="players" onClick={openSkin}>
          Skin
        </Button>
      ) : null}
      {isActive ? (
        <>
          <Tag tone="success">Actif</Tag>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              closeAccountsDialog();
              requestLogout(profile);
            }}
          >
            Se déconnecter
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            closeAccountsDialog();
            void selectAccount(profile);
          }}
        >
          Utiliser
        </Button>
      )}
    </>
  );
}

function AccountListDialog() {
  const active = activeAccount.value;
  const list = accounts.value;
  const loggingIn = activeTask.value === 'login';
  return (
    <Dialog open onClose={closeAccountsDialog} title={active ? 'Comptes' : 'Se connecter'}>
      {list.length > 0 ? (
        <ul class="accounts-dialog__list" aria-label="Comptes sur ce PC">
          {list.map((profile) => {
            const isActive = profile.id === active?.id;
            return <AccountRow key={profile.id} profile={profile} active={isActive} actions={<ListActions profile={profile} isActive={isActive} />} />;
          })}
        </ul>
      ) : (
        <p class="accounts-dialog__intro">Connecte-toi pour jouer sur Karamon.</p>
      )}
      <div class="accounts-dialog__actions">
        <Button variant="primary" full loading={loggingIn} disabled={isBusy.value && !loggingIn} onClick={startMicrosoftLogin}>
          {loggingIn ? 'Connexion Microsoft en cours…' : 'Se connecter avec Microsoft'}
        </Button>
        <Button full pixel="profile" onClick={() => (accountsDialogView.value = 'offline')}>
          Jouer sans compte Microsoft
        </Button>
        <p class="accounts-dialog__note">Sans compte Microsoft : pour jouer sans licence Minecraft.</p>
      </div>
    </Dialog>
  );
}

function LogoutConfirmDialog() {
  const profile = logoutRequest.value;
  const cancel = () => (logoutRequest.value = null);
  return (
    <Dialog
      open={profile !== null}
      onClose={cancel}
      role="alertdialog"
      size="sm"
      title={profile ? `Se déconnecter de ${profile.name} ?` : ''}
      description={
        profile?.kind === 'offline'
          ? 'Le launcher oublie ce pseudo. Ton compte Karamon et ton mot de passe restent sur le serveur : tu pourras revenir avec le même pseudo.'
          : 'Il faudra te reconnecter avec Microsoft pour jouer avec ce compte.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => void confirmLogout()}>
            Se déconnecter
          </Button>
        </>
      }
    />
  );
}

export function AccountsDialog() {
  const open = accountsDialogOpen.value;
  return (
    <>
      {open && accountsDialogView.value === 'list' ? <AccountListDialog /> : null}
      {open && accountsDialogView.value === 'offline' ? <OfflineLoginDialog /> : null}
      <LogoutConfirmDialog />
    </>
  );
}
