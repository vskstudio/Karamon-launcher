import { useEffect, useRef, useState } from 'preact/hooks';
import type { MinecraftProfile, NameStatus } from '../../../ipc/contract';
import { OFFLINE_NAME_MAX, OFFLINE_NAME_TAKEN, offlineNameProblem } from '../../../shared/OfflineName';
import { accountsDialogView, closeAccountsDialog } from '../../state/accounts';
import { api } from '../../state/api';
import { applySession } from '../../state/session';
import { Button, Dialog, PixelIcon, TextField } from '../../ui';
import './accounts.css';

const NAME_CHECK_DELAY_MS = 450;

type HintTone = 'dim' | 'ok' | 'warn' | 'error';

interface Hint {
  text: string;
  tone: HintTone;
}

const initialHint: Hint = { text: 'De 3 à 16 caractères : lettres, chiffres et _.', tone: 'dim' };

function hintForCheck(result: NameStatus): Hint {
  if (result === 'taken') return { text: `${OFFLINE_NAME_TAKEN} Si c’est le tien, connecte-toi avec Microsoft.`, tone: 'warn' };
  if (result === 'free') return { text: 'Pseudo libre.', tone: 'ok' };
  return { text: 'Mojang ne répond pas, impossible de vérifier ce pseudo. Tu peux continuer.', tone: 'dim' };
}

type OfflineLogin = { ok: true; profile: MinecraftProfile } | { ok: false; error: string };

async function loginOffline(name: string): Promise<OfflineLogin> {
  try {
    return { ok: true, profile: await api.authLoginOffline(name) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function OfflineLoginDialog() {
  const [name, setName] = useState('');
  const [hint, setHint] = useState<Hint>(initialHint);
  const [taken, setTaken] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkId = useRef(0);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCheck = () => {
    checkId.current++;
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = null;
  };

  useEffect(() => cancelCheck, []);

  const onInput = (value: string) => {
    setName(value);
    cancelCheck();
    setTaken(false);
    const problem = offlineNameProblem(value);
    if (problem) {
      setHint({ text: problem, tone: value.length === 0 ? 'dim' : 'error' });
      return;
    }
    setHint({ text: 'Vérification du pseudo…', tone: 'dim' });
    const id = checkId.current;
    checkTimer.current = setTimeout(() => {
      void api
        .authCheckName(value)
        .catch((): NameStatus => 'unknown')
        .then((result) => {
          if (id !== checkId.current) return;
          setTaken(result === 'taken');
          setHint(hintForCheck(result));
        });
    }, NAME_CHECK_DELAY_MS);
  };

  const canSend = offlineNameProblem(name) === null && !taken && !sending;

  const send = async () => {
    if (!canSend) return;
    cancelCheck();
    setSending(true);
    const result = await loginOffline(name);
    setSending(false);
    if (!result.ok) {
      setTaken(result.error === OFFLINE_NAME_TAKEN);
      setHint({ text: result.error, tone: 'error' });
      inputRef.current?.focus();
      return;
    }
    closeAccountsDialog();
    applySession(await api.authGetSession(), `Connecté en tant que ${result.profile.name}, sans compte Microsoft.`);
  };

  return (
    <Dialog
      open
      onClose={closeAccountsDialog}
      title="Jouer sans compte Microsoft"
      footer={
        <>
          <Button variant="ghost" onClick={() => (accountsDialogView.value = 'list')}>
            Retour
          </Button>
          <Button variant="primary" loading={sending} disabled={!canSend} onClick={() => void send()}>
            {sending ? 'Vérification…' : 'Continuer'}
          </Button>
        </>
      }
    >
      <TextField
        label="Pseudo"
        value={name}
        onInput={onInput}
        placeholder="Ton pseudo"
        maxLength={OFFLINE_NAME_MAX}
        autoFocus
        inputRef={inputRef}
        onEnter={() => void send()}
        hint={hint.tone === 'error' ? undefined : hint.text}
        error={hint.tone === 'error' ? hint.text : null}
        class={`accounts-name accounts-name--${hint.tone}`}
      />
      <ul class="accounts-explain">
        <li>
          <PixelIcon name="lock" size={18} />
          <span>Ton compte Karamon sera protégé par un mot de passe que le jeu te demandera à la connexion.</span>
        </li>
        <li>
          <PixelIcon name="players" size={18} />
          <span>Ton skin se choisit dans la page Skins du launcher, sinon il vient d’Ely.by ou TLauncher, ou de /skin en jeu.</span>
        </li>
      </ul>
    </Dialog>
  );
}
