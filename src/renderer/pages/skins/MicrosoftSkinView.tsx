import { useMemo } from 'preact/hooks';
import type { MinecraftProfile } from '../../../ipc/contract';
import { api } from '../../state/api';
import { Button, PageHeader, Panel } from '../../ui';
import { detectModel } from './skinRender';
import { SkinPreview } from './SkinPreview';

const MINECRAFT_SKIN_EDITOR_URL = 'https://www.minecraft.net/msaprofile/mygames/editskin';

interface MicrosoftSkinViewProps {
  profile: MinecraftProfile;
  current: HTMLImageElement | null;
  currentLoading: boolean;
}

export function MicrosoftSkinView({ profile, current, currentLoading }: MicrosoftSkinViewProps) {
  const model = useMemo(() => (current ? detectModel(current) : 'classic'), [current]);
  return (
    <>
      <SkinPreview
        image={current}
        model={model}
        loading={currentLoading}
        emptyText="Pas de skin à afficher pour ce profil."
      />
      <div class="skins__panel">
        <PageHeader
          eyebrow="Apparence"
          title="Skins"
          description="Le skin d’un compte Microsoft se change sur minecraft.net. Le launcher affiche celui de ton profil Minecraft."
        />
        <Panel class="skins__apply">
          <div class="skins__apply-text">
            <strong>Skin de {profile.name}</strong>
            <span>
              {current ? 'Synchronisé avec ton profil Minecraft.' : 'Ton profil Minecraft n’a pas de skin personnalisé, ou il n’a pas pu être chargé.'}
            </span>
          </div>
          <div class="skins__apply-actions">
            <Button variant="primary" glyph="external" onClick={() => void api.openExternal(MINECRAFT_SKIN_EDITOR_URL)}>
              Changer sur minecraft.net
            </Button>
          </div>
        </Panel>
        <p class="skins__note">Un skin changé sur minecraft.net s’affiche en jeu tout de suite, et ici au prochain démarrage du launcher.</p>
      </div>
    </>
  );
}
