import type { MinecraftProfile } from '../../ipc/contract';

export class AccountChip {
  constructor(
    private readonly root: HTMLElement,
    private readonly onLogoutClick: () => void,
    private readonly skinUrl: (profileId: string) => Promise<string | null>,
  ) {
    this.root.addEventListener('click', () => this.onLogoutClick());
  }

  render(profile: MinecraftProfile | null): void {
    if (!profile) {
      this.root.style.display = 'none';
      this.root.classList.remove('signed-in');
      return;
    }
    this.root.style.display = '';
    this.root.classList.add('signed-in');
    this.root.title = `${profile.name}, cliquer pour se déconnecter`;
    this.root.replaceChildren(
      this.avatar(profile.id),
      AccountChip.label(profile.name),
    );
  }

  /** The face and hat layer cut from the player's own skin, or Crafatar's render if Mojang has none. */
  private avatar(profileId: string): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'chip-avatar';
    void this.skinUrl(profileId).then((url) => {
      if (url) {
        const face = document.createElement('span');
        face.className = 'chip-face';
        const layer = `url("${url}")`;
        face.style.backgroundImage = `${layer}, ${layer}`;
        wrapper.replaceChildren(face);
      } else {
        wrapper.replaceChildren(AccountChip.crafatar(profileId));
      }
    });
    return wrapper;
  }

  private static crafatar(profileId: string): HTMLElement {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `https://crafatar.com/avatars/${encodeURIComponent(profileId)}?size=48&overlay`;
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
    return img;
  }

  private static label(name: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'chip-label';
    span.textContent = name;
    return span;
  }
}
