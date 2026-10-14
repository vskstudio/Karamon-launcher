import type { LauncherApi, ModEntry } from '../../ipc/contract';
import { Toast } from './Toast';

export class ModsList {
  private readonly api: LauncherApi;
  private readonly container: HTMLElement;
  private loaded = false;

  constructor(api: LauncherApi, container: HTMLElement) {
    this.api = api;
    this.container = container;
  }

  invalidate(): void {
    this.loaded = false;
  }

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    const result = await this.api.listMods();
    this.render(result.mods);
    this.loaded = true;
  }

  private render(mods: ModEntry[]): void {
    this.container.textContent = '';
    if (mods.length === 0) {
      this.container.classList.remove('has-items');
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = 'Aucun mod installé. Synchronisez le pack pour les télécharger.';
      this.container.appendChild(p);
      return;
    }
    this.container.classList.add('has-items');
    const header = document.createElement('div');
    header.className = 'mods-toolbar';
    const enabled = mods.filter((m) => m.enabled);
    header.textContent =
      `${enabled.length} mods actifs · ${ModsList.formatSize(enabled.reduce((a, m) => a + m.size, 0))}` +
      (enabled.length < mods.length ? ` · ${mods.length - enabled.length} désactivé(s)` : '');
    this.container.appendChild(header);

    for (const mod of mods) {
      const row = document.createElement('label');
      row.className = 'mod-row' + (mod.enabled ? '' : ' mod-off');
      row.title = mod.enabled
        ? 'Décocher pour désactiver ce mod (désactiver un mod essentiel peut empêcher le jeu de démarrer)'
        : 'Cocher pour réactiver ce mod';
      const wrap = document.createElement('span');
      wrap.className = 'checkbox-wrap';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = mod.enabled;
      input.addEventListener('change', () => void this.toggle(mod.name, input));
      const mark = document.createElement('span');
      mark.className = 'checkmark';
      wrap.append(input, mark);
      const name = document.createElement('span');
      name.className = 'mod-name';
      name.textContent = mod.name;
      const size = document.createElement('span');
      size.className = 'mod-size';
      size.textContent = ModsList.formatSize(mod.size);
      row.append(wrap, name, size);
      this.container.appendChild(row);
    }
  }

  private async toggle(name: string, input: HTMLInputElement): Promise<void> {
    input.disabled = true;
    try {
      const result = await this.api.setModEnabled(name, input.checked);
      this.render(result.mods);
    } catch (e) {
      input.checked = !input.checked;
      input.disabled = false;
      Toast.show((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    }
  }

  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
