import { Lock, LogIn, Shirt, UserRound } from 'lucide';
import type { AuthSessionResult, LauncherApi, MinecraftProfile, NameCheckResult } from '../../ipc/contract';
import { OFFLINE_NAME_MAX, OFFLINE_NAME_TAKEN, offlineNameProblem } from '../../shared/OfflineName';
import { badge, button, confirmDialog, field, h, icon, list, openDialog, textInput, withBusy, type Child, type Dialog } from '../lib/ui';
import { playerAvatar, type SkinUrlLookup } from './PlayerAvatar';
import './AccountDialog.css';

const NAME_CHECK_DELAY_MS = 450;

export interface AccountDialogOptions {
  api: LauncherApi;
  skinUrl: SkinUrlLookup;
  /** Runs the Microsoft login (the renderer owns the play button state while it runs). */
  loginMicrosoft: () => Promise<void>;
  /** The accounts changed: an offline login, a switch or a logout. */
  onChanged: (state: AuthSessionResult, message: string) => void;
}

type HintTone = 'dim' | 'ok' | 'warn' | 'error';

/** « Comptes » / « Se connecter »: the remembered accounts, Microsoft login, and the offline form. */
export class AccountDialog {
  constructor(private readonly options: AccountDialogOptions) {}

  async open(): Promise<void> {
    this.openAccounts(await this.options.api.authGetSession());
  }

  private openAccounts(state: AuthSessionResult): void {
    let dialog: Dialog | null = null;
    const close = (): void => dialog?.close();

    const microsoft = button({
      label: 'Se connecter avec Microsoft',
      variant: 'primary',
      icon: LogIn,
      block: true,
      onClick: () => {
        close();
        void this.options.loginMicrosoft();
      },
    });
    const offline = button({
      label: 'Jouer sans compte Microsoft',
      variant: 'secondary',
      icon: UserRound,
      block: true,
      onClick: () => {
        close();
        this.openOffline();
      },
    });

    const body: Child[] = [];
    if (state.accounts.length > 0) {
      body.push(
        h('div', { className: 'account-list' }, list(...state.accounts.map((a) => this.accountRow(a, state.active, close)))),
      );
    } else {
      body.push(h('p', { className: 'account-intro', text: 'Connecte-toi pour jouer sur Karamon.' }));
    }
    body.push(
      h(
        'div',
        { className: 'account-actions' },
        microsoft,
        offline,
        h('p', { className: 'account-note', text: 'Sans compte Microsoft : pour jouer sans licence Minecraft.' }),
      ),
    );

    dialog = openDialog({ title: state.active ? 'Comptes' : 'Se connecter', body });
  }

  private accountRow(account: MinecraftProfile, active: MinecraftProfile | null, closeList: () => void): HTMLElement {
    const isActive = active?.id === account.id;
    const actions = isActive
      ? [
          badge('Actif', 'green'),
          button({ label: 'Se déconnecter', variant: 'ghost', size: 'sm', onClick: () => void this.logout(account, closeList) }),
        ]
      : [button({ label: 'Utiliser', size: 'sm', onClick: () => void this.switchTo(account, closeList) })];
    return h(
      'div',
      { className: 'ui-row account-row', attrs: { role: 'listitem' } },
      playerAvatar(account, this.options.skinUrl, 'account-avatar'),
      h(
        'div',
        { className: 'ui-row__main' },
        h('span', { className: 'ui-row__title', text: account.name }),
        h('span', {
          className: 'account-kind',
          text: account.kind === 'offline' ? 'Sans compte Microsoft' : 'Compte Microsoft',
        }),
      ),
      h('div', { className: 'ui-row__actions' }, ...actions),
    );
  }

  private async switchTo(account: MinecraftProfile, closeList: () => void): Promise<void> {
    closeList();
    try {
      const state = await this.options.api.authSwitch(account.id);
      this.options.onChanged(state, `Tu joues maintenant avec ${account.name}.`);
    } catch (e) {
      this.options.onChanged(await this.options.api.authGetSession(), (e as Error).message);
    }
  }

  private async logout(account: MinecraftProfile, closeList: () => void): Promise<void> {
    closeList();
    const ok = await confirmDialog({
      title: `Se déconnecter de ${account.name} ?`,
      text:
        account.kind === 'offline'
          ? 'Le launcher oublie ce pseudo. Ton compte Karamon et ton mot de passe restent sur le serveur : tu pourras revenir avec le même pseudo.'
          : 'Il faudra te reconnecter avec Microsoft pour jouer avec ce compte.',
      confirmLabel: 'Se déconnecter',
      danger: true,
    });
    if (!ok) return;
    this.options.onChanged(await this.options.api.authLogout(), 'Déconnecté.');
  }

  private openOffline(): void {
    const api = this.options.api;
    const input = textInput({ id: 'offline-name', placeholder: 'Ton pseudo' });
    input.maxLength = OFFLINE_NAME_MAX;
    input.autocomplete = 'off';
    const nameField = field({ label: 'Pseudo', control: input, htmlFor: 'offline-name', hint: 'De 3 à 16 caractères : lettres, chiffres et _.' });
    const submit = button({ label: 'Continuer', variant: 'primary' });
    const back = button({ label: 'Retour', variant: 'ghost' });
    submit.disabled = true;

    let check = 0;
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    let taken = false;

    const setHint = (text: string, tone: HintTone): void => {
      nameField.hint.hidden = false;
      nameField.hint.textContent = text;
      nameField.hint.className = `ui-field__hint account-hint account-hint--${tone}`;
    };

    const onCheck = (result: NameCheckResult): void => {
      taken = result === 'taken';
      if (result === 'taken') setHint(`${OFFLINE_NAME_TAKEN} Si c’est le tien, connecte-toi avec Microsoft.`, 'warn');
      else if (result === 'free') setHint('Pseudo libre.', 'ok');
      else setHint('Mojang ne répond pas, impossible de vérifier ce pseudo. Tu peux continuer.', 'dim');
      submit.disabled = taken;
    };

    const validate = (): void => {
      const name = input.value;
      const id = ++check;
      if (checkTimer) clearTimeout(checkTimer);
      taken = false;
      const problem = offlineNameProblem(name);
      if (problem) {
        submit.disabled = true;
        setHint(problem, name.length === 0 ? 'dim' : 'error');
        return;
      }
      submit.disabled = false;
      setHint('Vérification du pseudo…', 'dim');
      checkTimer = setTimeout(() => {
        void api.authCheckName(name).then((result) => {
          if (id === check) onCheck(result);
        });
      }, NAME_CHECK_DELAY_MS);
    };

    const send = async (): Promise<void> => {
      const name = input.value;
      if (offlineNameProblem(name) || taken) return;
      check++;
      if (checkTimer) clearTimeout(checkTimer);
      const result = await withBusy(submit, 'Vérification…', () => api.authLoginOffline(name));
      if (!result.ok) {
        taken = result.error === OFFLINE_NAME_TAKEN;
        submit.disabled = taken;
        setHint(result.error, 'error');
        input.focus();
        return;
      }
      dialog.close();
      this.options.onChanged(await api.authGetSession(), `Connecté en tant que ${result.profile.name}, sans compte Microsoft.`);
    };

    input.addEventListener('input', validate);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !submit.disabled) void send();
    });
    submit.addEventListener('click', () => void send());

    const dialog = openDialog({
      title: 'Jouer sans compte Microsoft',
      body: [
        nameField.root,
        h(
          'ul',
          { className: 'account-explain' },
          h('li', {}, icon(Lock, 16), h('span', { text: 'Ton compte Karamon sera protégé par un mot de passe que le jeu te demandera à la connexion.' })),
          h('li', {}, icon(Shirt, 16), h('span', { text: 'Ton skin vient d’Ely.by ou TLauncher, ou se choisit en jeu avec /skin.' })),
        ),
      ],
      foot: [back, submit],
    });
    back.addEventListener('click', () => {
      dialog.close();
      void this.open();
    });
    input.focus();
  }
}
