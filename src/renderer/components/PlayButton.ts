export class PlayButton {
  private readonly icon: HTMLElement;

  constructor(private readonly btn: HTMLElement, private readonly label: HTMLElement) {
    const icon = btn.querySelector<HTMLElement>('.play-btn-icon');
    if (!icon) throw new Error('PlayButton: .play-btn-icon introuvable');
    this.icon = icon;
  }

  setIdle(): void {
    this.apply('play-btn', 'Jouer', '1');
  }

  setLoading(): void {
    this.apply('play-btn loading', 'Chargement…', '0.5');
  }

  setRunning(): void {
    this.apply('play-btn running', 'En jeu', '1');
  }

  setLoginRequired(): void {
    this.apply('play-btn login-required', 'Se connecter', '1');
  }

  private apply(className: string, label: string, opacity: string): void {
    this.btn.className = className;
    this.label.textContent = label;
    this.icon.style.opacity = opacity;
  }
}
