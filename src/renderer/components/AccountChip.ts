import type { MinecraftProfile } from '../../ipc/contract';
import { playerAvatar, type SkinUrlLookup } from './PlayerAvatar';

export class AccountChip {
  constructor(
    private readonly root: HTMLElement,
    onClick: () => void,
    private readonly skinUrl: SkinUrlLookup,
  ) {
    this.root.addEventListener('click', () => onClick());
  }

  render(profile: MinecraftProfile | null): void {
    if (!profile) {
      this.root.style.display = 'none';
      this.root.classList.remove('signed-in');
      return;
    }
    this.root.style.display = '';
    this.root.classList.add('signed-in');
    this.root.title =
      profile.kind === 'offline'
        ? `${profile.name} (sans compte Microsoft), cliquer pour gérer les comptes`
        : `${profile.name}, cliquer pour gérer les comptes`;
    this.root.replaceChildren(
      playerAvatar(profile, this.skinUrl, 'chip-avatar'),
      AccountChip.label(profile.name),
    );
  }

  private static label(name: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'chip-label';
    span.textContent = name;
    return span;
  }
}
