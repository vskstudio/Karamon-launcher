import type { LauncherApi, ReleaseNote } from '../../ipc/contract';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export class ReleaseCards {
  private readonly api: LauncherApi;
  private readonly grid: HTMLElement;

  constructor(api: LauncherApi, grid: HTMLElement) {
    this.api = api;
    this.grid = grid;
  }

  async load(): Promise<void> {
    const releases = await this.api.listReleases();
    this.grid.textContent = '';
    if (releases.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'Les notes de version ne sont pas disponibles pour le moment.';
      this.grid.appendChild(hint);
      return;
    }
    for (const release of releases) this.grid.appendChild(this.card(release));
  }

  private card(release: ReleaseNote): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'release-card';
    card.addEventListener('click', () => {
      if (release.url) void this.api.openExternal(release.url);
    });

    const head = document.createElement('div');
    head.className = 'release-card__head';
    const logo = document.createElement('img');
    logo.src = '../assets/brand/Karamon.png';
    logo.alt = '';
    logo.className = 'release-card__logo';
    const date = document.createElement('span');
    date.className = 'release-card__date';
    date.textContent = release.publishedAt ? DATE_FORMAT.format(release.publishedAt) : '';
    head.append(logo, date);

    const title = document.createElement('h3');
    title.textContent = `Launcher ${release.version}`;

    card.append(head, title);
    if (release.highlights.length > 0) {
      const list = document.createElement('ul');
      for (const highlight of release.highlights) {
        const item = document.createElement('li');
        item.textContent = highlight;
        list.appendChild(item);
      }
      card.appendChild(list);
    } else {
      const more = document.createElement('p');
      more.textContent = 'Voir les détails de la version';
      card.appendChild(more);
    }
    return card;
  }
}
