import { Camera, ChevronLeft, ChevronRight, Maximize2, Trash2, X } from 'lucide';
import type { LauncherApi, ScreenshotEntry } from '../../ipc/contract';
import {
  Toast,
  button,
  card,
  confirmDialog,
  emptyState,
  h,
  pageHeader,
  searchInput,
  selectInput,
} from '../lib/ui';
import { dayLabel, formatDayTime, formatSize } from '../util/format';
import type { Page } from './Page';
import './ScreenshotsPage.css';

type SortOrder = 'recent' | 'oldest';

interface ScreenshotsPageOptions {
  api: LauncherApi;
}

interface DayGroup {
  label: string;
  items: ScreenshotEntry[];
}

const PLURAL_FORMAT = new Intl.NumberFormat('fr-FR');

export class ScreenshotsPage implements Page {
  readonly root: HTMLElement;
  private readonly api: LauncherApi;
  private readonly subtitle = h('span');
  private readonly body = h('div', { className: 'shots-body' });
  private readonly scroll = h('div', { className: 'shots-scroll' });
  private readonly detailHost = h('div', { className: 'shots-detail-host' });
  private readonly search = searchInput({
    placeholder: 'Rechercher une capture',
    onInput: (value) => {
      this.query = value.trim().toLowerCase();
      this.renderGrid();
    },
  });
  private readonly sortSelect = selectInput({
    items: [
      { value: 'recent', label: 'Plus récentes' },
      { value: 'oldest', label: 'Plus anciennes' },
    ],
    onChange: (value) => {
      this.sort = value === 'oldest' ? 'oldest' : 'recent';
      this.renderGrid();
    },
  });
  private all: ScreenshotEntry[] = [];
  private visible: ScreenshotEntry[] = [];
  private selectedName: string | null = null;
  private query = '';
  private sort: SortOrder = 'recent';
  private tiles = new Map<string, HTMLButtonElement>();
  private lightbox: { close(): void } | null = null;

  constructor(root: HTMLElement, options: ScreenshotsPageOptions) {
    this.root = root;
    this.api = options.api;
    this.root.append(
      pageHeader({ title: 'Captures', subtitle: this.subtitle }),
      this.body,
    );
    this.renderAll();
  }

  enter(): void {
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const result = await this.api.listScreenshots();
      this.all = result.screenshots;
      this.renderAll();
    } catch {
      Toast.show('Impossible de charger les captures.', 'error');
    }
  }

  private sorted(): ScreenshotEntry[] {
    const direction = this.sort === 'recent' ? -1 : 1;
    return this.all
      .filter((item) => item.name.toLowerCase().includes(this.query))
      .sort((a, b) => (a.mtime - b.mtime) * direction);
  }

  private renderAll(): void {
    const totalSize = this.all.reduce((sum, item) => sum + item.size, 0);
    const count = this.all.length;
    this.subtitle.textContent =
      count === 0
        ? 'Appuie sur F2 en jeu pour prendre une capture.'
        : `${PLURAL_FORMAT.format(count)} capture${count > 1 ? 's' : ''}, ${formatSize(totalSize)}. F2 en jeu pour en prendre une.`;

    if (count === 0) {
      this.body.replaceChildren(
        h(
          'div',
          { style: { 'grid-column': '1 / -1' } },
          emptyState({ icon: Camera, title: 'Aucune capture', text: 'Appuie sur F2 en jeu pour en prendre une.' }),
        ),
      );
      return;
    }

    const toolbar = h('div', { className: 'shots-toolbar' }, this.search.root, this.sortSelect);
    this.body.replaceChildren(
      h('div', { className: 'shots-main' }, toolbar, this.scroll),
      this.detailHost,
    );
    this.renderGrid();
  }

  private renderGrid(): void {
    this.visible = this.sorted();
    this.tiles = new Map();
    if (this.visible.length === 0) {
      this.scroll.replaceChildren(emptyState({ icon: Camera, title: 'Aucun résultat', text: 'Aucune capture ne correspond à ta recherche.' }));
      this.detailHost.replaceChildren();
      return;
    }
    const stillVisible = this.visible.some((item) => item.name === this.selectedName);
    if (!stillVisible) this.selectedName = this.visible[0].name;

    this.scroll.replaceChildren(...this.groupByDay(this.visible).map((group) => this.renderGroup(group)));
    this.syncSelection();
    this.renderDetail();
  }

  private groupByDay(items: ScreenshotEntry[]): DayGroup[] {
    const groups: DayGroup[] = [];
    let lastDay = '';
    for (const item of items) {
      const day = new Date(item.mtime).toDateString();
      if (day !== lastDay) {
        groups.push({ label: dayLabel(item.mtime), items: [] });
        lastDay = day;
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }

  private renderGroup(group: DayGroup): HTMLElement {
    return h(
      'section',
      { className: 'shots-group' },
      h(
        'h3',
        { className: 'shots-group__head' },
        group.label,
        h('span', { className: 'shots-group__count', text: String(group.items.length) }),
      ),
      h('div', { className: 'shots-grid' }, ...group.items.map((item) => this.renderTile(item))),
    );
  }

  private renderTile(item: ScreenshotEntry): HTMLButtonElement {
    const image = h('img', { attrs: { src: item.url, alt: item.name, loading: 'lazy', draggable: 'false' } });
    const tile = h('button', {
      className: 'shots-tile',
      title: item.name,
      attrs: { type: 'button' },
      on: {
        click: () => this.select(item.name),
        dblclick: () => this.openLightbox(item.name),
      },
    }, image);
    this.tiles.set(item.name, tile);
    return tile;
  }

  private select(name: string): void {
    if (this.selectedName === name) return;
    this.selectedName = name;
    this.syncSelection();
    this.renderDetail();
  }

  private syncSelection(): void {
    for (const [name, tile] of this.tiles) {
      tile.classList.toggle('shots-tile--selected', name === this.selectedName);
    }
  }

  private selectedEntry(): ScreenshotEntry | null {
    return this.visible.find((item) => item.name === this.selectedName) ?? null;
  }

  private renderDetail(): void {
    const entry = this.selectedEntry();
    if (!entry) {
      this.detailHost.replaceChildren();
      return;
    }
    const resolution = h('dd', { text: '...' });
    const preview = h('img', { attrs: { src: entry.url, alt: entry.name } });
    const showResolution = (): void => {
      if (preview.naturalWidth > 0) resolution.textContent = `${preview.naturalWidth} × ${preview.naturalHeight}`;
    };
    preview.addEventListener('load', showResolution);
    if (preview.complete) showResolution();

    const fact = (label: string, value: HTMLElement): HTMLElement =>
      h('div', { className: 'shots-fact' }, h('dt', { text: label }), value);

    const detail = card({
      className: 'shots-detail',
      flush: true,
      body: [
        h('div', { className: 'shots-preview' }, preview),
        h('div', { className: 'shots-name', text: entry.name }),
        h(
          'dl',
          { className: 'shots-facts' },
          fact('Date', h('dd', { text: formatDayTime(entry.mtime) })),
          fact('Résolution', resolution),
          fact('Taille', h('dd', { text: formatSize(entry.size) })),
        ),
      ],
      foot: [
        button({ icon: Trash2, variant: 'danger', title: 'Supprimer', onClick: () => void this.remove(entry) }),
        button({ label: 'Agrandir', icon: Maximize2, variant: 'primary', onClick: () => this.openLightbox(entry.name) }),
      ],
    });
    this.detailHost.replaceChildren(detail.root);
  }

  private async remove(entry: ScreenshotEntry): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Supprimer la capture',
      text: `${entry.name} sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    const index = this.visible.findIndex((item) => item.name === entry.name);
    try {
      const result = await this.api.deleteScreenshot(entry.name);
      this.all = result.screenshots;
    } catch {
      Toast.show('Suppression impossible.', 'error');
      return;
    }
    const remaining = this.sorted();
    this.selectedName = remaining[Math.min(index, remaining.length - 1)]?.name ?? null;
    this.renderAll();
    Toast.show('Capture supprimée.', 'ok');
  }

  private openLightbox(name: string): void {
    this.lightbox?.close();
    let index = this.visible.findIndex((item) => item.name === name);
    if (index < 0) return;

    const image = h('img', { className: 'shots-lightbox__img', attrs: { draggable: 'false' } });
    const captionName = h('span', { className: 'shots-lightbox__name' });
    const captionDate = h('span');
    const previous = button({ icon: ChevronLeft, variant: 'ghost', size: 'lg', title: 'Précédente', onClick: () => go(-1) });
    const next = button({ icon: ChevronRight, variant: 'ghost', size: 'lg', title: 'Suivante', onClick: () => go(1) });
    previous.classList.add('shots-lightbox__nav', 'shots-lightbox__nav--prev');
    next.classList.add('shots-lightbox__nav', 'shots-lightbox__nav--next');
    const closeButton = button({ icon: X, variant: 'ghost', title: 'Fermer', onClick: () => close() });
    closeButton.classList.add('shots-lightbox__close');

    const overlay = h(
      'div',
      { className: 'shots-lightbox', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Capture en grand' } },
      image,
      h('div', { className: 'shots-lightbox__caption' }, captionName, captionDate),
      previous,
      next,
      closeButton,
    );

    const show = (): void => {
      const entry = this.visible[index];
      image.src = entry.url;
      image.alt = entry.name;
      captionName.textContent = entry.name;
      captionDate.textContent = formatDayTime(entry.mtime);
      previous.hidden = index === 0;
      next.hidden = index === this.visible.length - 1;
      this.select(entry.name);
      this.tiles.get(entry.name)?.scrollIntoView({ block: 'nearest' });
    };
    const go = (step: number): void => {
      const target = index + step;
      if (target < 0 || target >= this.visible.length) return;
      index = target;
      show();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      } else if (event.key === 'ArrowLeft') {
        go(-1);
      } else if (event.key === 'ArrowRight') {
        go(1);
      }
    };
    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      this.lightbox = null;
    };

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    this.lightbox = { close };
    show();
  }
}
