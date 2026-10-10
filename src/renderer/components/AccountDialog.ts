import { Lock, LogIn, Shirt, UserRound } from 'lucide';
import type { AuthSessionResult, LauncherApi, MinecraftProfile, NameCheckResult } from '../../ipc/contract';
import { OFFLINE_NAME_MAX, OFFLINE_NAME_TAKEN, offlineNameProblem } from '../../shared/OfflineName';
import { badge, button, confirmDialog, field, h, icon, list, openDialog, segmented, textInput, withBusy, type Child, type Dialog } from '../lib/ui';
import { playerAvatar, type SkinUrlLookup } from './PlayerAvatar';
import './AccountDialog.css';

const NAME_CHECK_DELAY_MS = 450;
/** The server refuses bigger skins (AuthPayloads.MAX_SKIN_BYTES in the Karamon mod). */
const SKIN_MAX_BYTES = 32 * 1024;

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
    const skin =
      account.kind === 'offline'
        ? [button({ label: 'Skin', icon: Shirt, size: 'sm', variant: 'ghost', onClick: () => { closeList(); this.openSkin(account); } })]
        : [];
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
      h('div', { className: 'ui-row__actions' }, ...skin, ...actions),
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

  /** An offline account's skin: a PNG and its arm width, sent by the game with its next login to Karamon. */
  private openSkin(account: MinecraftProfile): void {
    const api = this.options.api;
    const fileInput = h('input', { attrs: { type: 'file', accept: 'image/png', id: 'skin-file' } });
    const fileField = field({
      label: 'Image du skin (.png)',
      control: fileInput,
      htmlFor: 'skin-file',
      hint: '64 × 64 ou 64 × 32 pixels, 32 Ko au plus.',
    });
    const preview = h('canvas', { className: 'skin-preview', attrs: { width: '16', height: '32', role: 'img', 'aria-label': 'Aperçu du skin, de face' } });
    let image: HTMLImageElement | null = null;
    let png: string | null = null;
    const model = segmented({
      label: 'Bras',
      items: [
        { value: 'classic', label: 'Bras classiques' },
        { value: 'slim', label: 'Bras fins' },
      ],
      value: 'classic',
      onChange: () => drawSkinFront(preview, image, model.value() === 'slim'),
    });
    const save = button({ label: 'Enregistrer', variant: 'primary' });
    const reset = button({ label: 'Skin par défaut', variant: 'ghost' });
    save.disabled = true;

    const setHint = (text: string, tone: HintTone): void => {
      fileField.hint.textContent = text;
      fileField.hint.className = `ui-field__hint account-hint account-hint--${tone}`;
    };

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      image = null;
      png = null;
      save.disabled = true;
      drawSkinFront(preview, null, false);
      if (!file) return;
      if (file.size > SKIN_MAX_BYTES) return setHint('Image trop lourde : 32 Ko au plus.', 'error');
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth !== 64 || (img.naturalHeight !== 64 && img.naturalHeight !== 32)) {
            setHint('Un skin fait 64 × 64 ou 64 × 32 pixels.', 'error');
            return;
          }
          image = img;
          png = url.slice(url.indexOf(',') + 1);
          save.disabled = false;
          setHint('Voilà ton skin. Choisis la largeur des bras, puis enregistre.', 'ok');
          drawSkinFront(preview, img, model.value() === 'slim');
        };
        img.onerror = () => setHint("Ce fichier n'est pas une image PNG.", 'error');
        img.src = url;
      };
      reader.readAsDataURL(file);
    });

    const done = async (message: string): Promise<void> => {
      dialog.close();
      this.options.onChanged(await api.authGetSession(), message);
    };
    save.addEventListener('click', () => {
      if (!png) return;
      const request = { name: account.name, png, model: model.value() === 'slim' ? 'slim' : 'classic' } as const;
      void withBusy(save, 'Enregistrement…', () => api.skinOfflineSet(request)).then((result) => {
        if (!result.ok) setHint(result.error ?? 'Skin non enregistré.', 'error');
        else void done('Skin enregistré : tu le porteras dès ta prochaine connexion au serveur.');
      });
    });
    reset.addEventListener('click', () => {
      void withBusy(reset, 'Un instant…', () => api.skinOfflineReset(account.name)).then((result) => {
        if (!result.ok) setHint(result.error ?? 'Impossible de revenir au skin par défaut.', 'error');
        else void done('Skin par défaut à ta prochaine connexion (celui d’Ely.by ou TLauncher, sinon Steve).');
      });
    });

    const dialog = openDialog({
      title: `Skin de ${account.name}`,
      body: [
        h('div', { className: 'skin-editor' }, preview, h('div', { className: 'skin-editor__form' }, fileField.root, model.root)),
        h('p', { className: 'account-note', text: 'Le serveur reçoit le skin à ta prochaine connexion, une fois ton mot de passe vérifié.' }),
      ],
      foot: [reset, save],
    });
    drawSkinFront(preview, null, false);
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
          h('li', {}, icon(Shirt, 16), h('span', { text: 'Ton skin se choisit ici (Comptes › Skin), sinon il vient d’Ely.by ou TLauncher, ou de /skin en jeu.' })),
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

/** The front of a skin (head, body, arms, legs, then the outer layer), on a 16 × 32 canvas scaled up by CSS. */
function drawSkinFront(canvas: HTMLCanvasElement, img: HTMLImageElement | null, slim: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) return;
  const arm = slim ? 3 : 4;
  const legacy = img.naturalHeight === 32;
  const part = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, mirror = false): void => {
    if (!mirror) return ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    ctx.save();
    ctx.translate(dx + sw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.restore();
  };
  part(8, 8, 8, 8, 4, 0);
  part(20, 20, 8, 12, 4, 8);
  part(44, 20, arm, 12, 4 - arm, 8);
  part(4, 20, 4, 12, 4, 20);
  if (legacy) {
    // 64 × 32: one arm and one leg, mirrored for the other side.
    part(44, 20, arm, 12, 12, 8, true);
    part(4, 20, 4, 12, 8, 20, true);
  } else {
    part(36, 52, arm, 12, 12, 8);
    part(20, 52, 4, 12, 8, 20);
    part(20, 36, 8, 12, 4, 8);
    part(44, 36, arm, 12, 4 - arm, 8);
    part(52, 52, arm, 12, 12, 8);
    part(4, 36, 4, 12, 4, 20);
    part(4, 52, 4, 12, 8, 20);
  }
  part(40, 8, 8, 8, 4, 0);
}
