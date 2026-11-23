import { useEffect, useRef, useState } from 'preact/hooks';
import type { MinecraftProfile, OfflineSkinResult } from '../../../ipc/contract';
import { api } from '../../state/api';
import { applySession } from '../../state/session';
import { forgetSkin } from '../../state/skins';
import { Button, cx, PageHeader, Panel, Segmented, SettingRow, type SegmentedItem } from '../../ui';
import { detectModel, loadSkinImage, type SkinModel } from './skinRender';
import { SkinPreview } from './SkinPreview';

const SKIN_MAX_BYTES = 32 * 1024;

const modelItems: readonly SegmentedItem<SkinModel>[] = [
  { value: 'classic', label: 'Classique' },
  { value: 'slim', label: 'Fin' },
];

interface ImportedSkin {
  image: HTMLImageElement;
  png: string;
  fileName: string;
}

interface Status {
  text: string;
  tone: 'ok' | 'error';
}

type Busy = 'apply' | 'reset' | null;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsDataURL(file);
  });
}

async function decodePng(file: File): Promise<{ url: string; image: HTMLImageElement } | null> {
  try {
    const url = await readAsDataUrl(file);
    return { url, image: await loadSkinImage(url) };
  } catch {
    return null;
  }
}

async function callSkinApi(call: () => Promise<OfflineSkinResult>): Promise<OfflineSkinResult> {
  try {
    return await call();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface OfflineSkinEditorProps {
  profile: MinecraftProfile;
  current: HTMLImageElement | null;
  currentLoading: boolean;
}

export function OfflineSkinEditor({ profile, current, currentLoading }: OfflineSkinEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ImportedSkin | null>(null);
  const [model, setModel] = useState<SkinModel>('classic');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    if (!imported && current) setModel(detectModel(current));
  }, [current]);

  const fail = (text: string) => setStatus({ text, tone: 'error' });

  const importFile = async (file: File) => {
    setImported(null);
    setStatus(null);
    if (file.size > SKIN_MAX_BYTES) {
      fail('Image trop lourde : 32 Ko au plus.');
      return;
    }
    if (file.type && file.type !== 'image/png') {
      fail('Ce fichier n’est pas une image PNG.');
      return;
    }
    const decoded = await decodePng(file);
    if (!decoded) {
      fail('Ce fichier n’est pas une image PNG.');
      return;
    }
    const { url, image } = decoded;
    if (image.naturalWidth !== 64 || (image.naturalHeight !== 64 && image.naturalHeight !== 32)) {
      fail('Un skin fait 64 × 64 ou 64 × 32 pixels.');
      return;
    }
    setImported({ image, png: url.slice(url.indexOf(',') + 1), fileName: file.name });
    setModel(detectModel(image));
    setStatus({ text: 'Voilà ton skin. Choisis la largeur des bras, puis applique-le.', tone: 'ok' });
  };

  const onFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void importFile(file);
  };

  const finish = async (message: string) => {
    forgetSkin(profile.id);
    setImported(null);
    setStatus(null);
    applySession(await api.authGetSession(), message);
  };

  const apply = async () => {
    if (!imported || busy) return;
    setBusy('apply');
    const request = { name: profile.name, png: imported.png, model };
    const result = await callSkinApi(() => api.skinOfflineSet(request));
    setBusy(null);
    if (!result.ok) {
      fail(result.error ?? 'Skin non enregistré.');
      return;
    }
    await finish('Skin enregistré : tu le porteras dès ta prochaine connexion au serveur.');
  };

  const reset = async () => {
    if (busy) return;
    setBusy('reset');
    const result = await callSkinApi(() => api.skinOfflineReset(profile.name));
    setBusy(null);
    if (!result.ok) {
      fail(result.error ?? 'Impossible de revenir au skin par défaut.');
      return;
    }
    await finish('Skin par défaut à ta prochaine connexion (celui d’Ely.by ou TLauncher, sinon Steve).');
  };

  return (
    <>
      <SkinPreview
        image={imported?.image ?? current}
        model={model}
        loading={currentLoading}
        emptyText="Aucun skin choisi : le serveur prend celui d’Ely.by ou TLauncher, sinon Steve."
      />
      <div class="skins__panel">
        <PageHeader
          eyebrow="Apparence"
          title="Skins"
          description={`Le skin de ${profile.name}, compte sans licence. Le serveur le reçoit à ta prochaine connexion, une fois ton mot de passe vérifié.`}
        />
        <Panel title="Importer un skin">
          <div class="skins__import">
            <Button glyph="upload" onClick={() => fileRef.current?.click()}>
              Choisir un fichier .png
            </Button>
            <span class="skins__hint">64 × 64 ou 64 × 32 pixels, 32 Ko au plus.</span>
          </div>
          <input ref={fileRef} type="file" accept="image/png" class="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={onFileChange} />
          <p class={cx('skins__status', status && `skins__status--${status.tone}`)} role="status">
            {status?.text ?? ''}
          </p>
          <SettingRow
            title="Modèle"
            description="La largeur des bras de ton skin."
            control={() => <Segmented items={modelItems} value={model} onChange={setModel} label="Largeur des bras" size="sm" />}
          />
        </Panel>
        <Panel class="skins__apply">
          <div class="skins__apply-text">
            <strong>{imported ? `Nouveau skin : ${imported.fileName}` : 'Skin actuel'}</strong>
            <span>
              {imported
                ? 'Pas encore appliqué. Il remplacera ton skin actuel.'
                : current
                  ? 'Celui que tu vois dans l’aperçu.'
                  : 'Aucun skin choisi pour ce compte.'}
            </span>
          </div>
          <div class="skins__apply-actions">
            <Button variant="ghost" loading={busy === 'reset'} disabled={busy === 'apply'} onClick={() => void reset()}>
              Réinitialiser
            </Button>
            <Button variant="primary" loading={busy === 'apply'} disabled={!imported || busy === 'reset'} onClick={() => void apply()}>
              Appliquer
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
