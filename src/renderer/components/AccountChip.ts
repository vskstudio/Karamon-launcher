import type { MinecraftProfile } from '../../ipc/contract';

export class AccountChip {
  constructor(
    private readonly root: HTMLElement,
    private readonly onLogoutClick: () => void,
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
    this.root.title = `${profile.name} — cliquer pour se déconnecter`;
    this.root.replaceChildren(
      AccountChip.avatar(profile.id),
      AccountChip.label(profile.name),
    );
  }

  private static avatar(profileId: string): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'chip-avatar';
    const img = document.createElement('img');
    img.alt = '';
    img.src = `https://crafatar.com/avatars/${encodeURIComponent(profileId)}?size=48&overlay`;
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
    wrapper.appendChild(img);
    return wrapper;
  }

  private static label(name: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'chip-label';
    span.textContent = name;
    return span;
  }
}
