import { UserRound } from 'lucide';
import type { MinecraftProfile } from '../../ipc/contract';
import { icon } from '../lib/ui';

export type SkinUrlLookup = (profile: MinecraftProfile) => Promise<string | null>;

/**
 * The face and hat layer cut from the player's skin: Mojang's for a Microsoft account, Ely.by's for an offline one.
 * Without a skin: Crafatar's render for a Microsoft account, a plain head for an offline one (Crafatar only knows
 * Mojang UUIDs).
 */
export function playerAvatar(profile: MinecraftProfile, skinUrl: SkinUrlLookup, className: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = className;
  void skinUrl(profile).then((url) => {
    if (url) {
      const face = document.createElement('span');
      face.className = 'chip-face';
      const layer = `url("${url}")`;
      face.style.backgroundImage = `${layer}, ${layer}`;
      wrapper.replaceChildren(face);
    } else if (profile.kind === 'offline') {
      wrapper.classList.add('chip-avatar-empty');
      wrapper.replaceChildren(icon(UserRound, 14));
    } else {
      wrapper.replaceChildren(crafatar(profile.id));
    }
  });
  return wrapper;
}

function crafatar(profileId: string): HTMLElement {
  const img = document.createElement('img');
  img.alt = '';
  img.src = `https://crafatar.com/avatars/${encodeURIComponent(profileId)}?size=48&overlay`;
  img.addEventListener('error', () => {
    img.style.display = 'none';
  });
  return img;
}
