import { FolderOpen, Hammer, Package, RefreshCw, SearchX } from 'lucide';
import type { LauncherApi, ModEntry } from '../../ipc/contract';
import {
  button,
  card,
  emptyState,
  h,
  keyValue,
  list,
  pageHeader,
  row,
  searchInput,
  withBusy,
  type Card,
} from '../lib/ui';
import { formatNumber, formatSize } from '../util/format';
import type { Page } from './Page';
import './PackPage.css';

export interface PackPageOptions {
  api: LauncherApi;
  sync: () => Promise<boolean>;
  repair: () => Promise<boolean>;
}

export class PackPage implements Page {
  readonly root: HTMLElement;
  private readonly api: LauncherApi;
  private readonly listCard: Card;
  private readonly countValue: HTMLElement;
  private readonly sizeValue: HTMLElement;
  private readonly folderValue: HTMLElement;
  private readonly syncButton: HTMLButtonElement;
  private readonly repairButton: HTMLButtonElement;
  private readonly search: { root: HTMLElement; input: HTMLInputElement };
  private mods: ModEntry[] = [];
  private loaded = false;

  constructor(root: HTMLElement, options: PackPageOptions) {
    this.root = root;
    this.api = options.api;

    this.syncButton = button({
      label: 'Mettre à jour le pack',
      variant: 'primary',
      icon: RefreshCw,
      onClick: () => void this.run(this.syncButton, 'Mise à jour…', options.sync),
    });
    this.repairButton = button({
      label: 'Réparer',
      icon: Hammer,
      onClick: () => void this.run(this.repairButton, 'Réparation…', options.repair),
    });
    const openFolder = button({
      label: 'Ouvrir le dossier',
      icon: FolderOpen,
      onClick: () => void this.api.openInstance(),
    });

    this.search = searchInput({ placeholder: 'Rechercher un mod', onInput: () => this.render() });
    this.listCard = card({
      title: 'Mods',
      meta: '',
      actions: [this.search.root],
      flush: true,
      scroll: true,
      className: 'pack-mods',
    });

    const count = keyValue('Mods installés', '…');
    const size = keyValue('Taille totale', '…');
    const folder = keyValue('Dossier', '…');
    this.countValue = count.value;
    this.sizeValue = size.value;
    this.folderValue = folder.value;
    this.folderValue.classList.add('pack-path');

    const summary = card({
      title: 'Installation',
      body: [count.root, size.root, folder.root],
      foot: [
        h('p', {
          className: 'pack-note',
          text: 'Réparer retélécharge les fichiers du pack manquants ou abîmés. Tes mondes ne sont pas touchés.',
        }),
      ],
    });

    root.append(
      pageHeader({
        title: 'Pack',
        subtitle: 'Les mods, resource packs et shaders du serveur, synchronisés avec Karamon.',
        actions: [openFolder, this.repairButton, this.syncButton],
      }),
      h('div', { className: 'pack-layout' }, this.listCard.root, h('div', { className: 'pack-side' }, summary.root)),
    );
  }

  enter(): void {
    void this.load();
  }

  async reload(): Promise<void> {
    this.loaded = false;
    await this.load();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const result = await this.api.listMods();
    this.mods = [...result.mods].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    this.folderValue.textContent = result.dir;
    this.folderValue.title = result.dir;
    this.loaded = true;
    this.render();
  }

  private async run(btn: HTMLButtonElement, busyLabel: string, task: () => Promise<boolean>): Promise<void> {
    await withBusy(btn, busyLabel, task);
  }

  private render(): void {
    const total = this.mods.reduce((sum, mod) => sum + mod.size, 0);
    this.countValue.textContent = formatNumber(this.mods.length);
    this.sizeValue.textContent = formatSize(total);
    if (this.listCard.meta) this.listCard.meta.textContent = `${formatNumber(this.mods.length)} fichiers`;

    if (this.mods.length === 0) {
      this.listCard.body.replaceChildren(
        emptyState({
          icon: Package,
          title: 'Aucun mod installé',
          text: 'Mets le pack à jour pour télécharger les mods du serveur.',
        }),
      );
      return;
    }

    const query = this.search.input.value.trim().toLowerCase();
    const visible = query ? this.mods.filter((mod) => mod.name.toLowerCase().includes(query)) : this.mods;
    if (visible.length === 0) {
      this.listCard.body.replaceChildren(
        emptyState({ icon: SearchX, title: 'Aucun résultat', text: `Aucun mod ne contient « ${query} ».` }),
      );
      return;
    }

    this.listCard.body.replaceChildren(
      list(
        ...visible.map((mod) =>
          row({
            leading: h('span', { className: 'pack-initial', text: PackPage.initial(mod.name) }),
            title: PackPage.displayName(mod.name),
            sub: mod.disabled ? `${mod.name} · désactivé` : mod.name,
            meta: formatSize(mod.size),
          }),
        ),
      ),
    );
  }

  private static displayName(fileName: string): string {
    const base = fileName.replace(/\.jar(\.disabled)?$/i, '');
    const withoutVersion = base.split(/[-_+](?=v?\d)/)[0] ?? base;
    const words = withoutVersion.replace(/[-_]+/g, ' ').trim();
    if (!words) return base;
    return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  private static initial(fileName: string): string {
    return (fileName.match(/\p{L}|\d/u)?.[0] ?? '?').toUpperCase();
  }
}
