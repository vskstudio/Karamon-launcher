import './ToolsPage.css';
import { Copy, DatabaseBackup, FileText, FolderOpen, Trash2 } from 'lucide';
import type { BackupEntry, CrashReport, LauncherApi } from '../../ipc/contract';
import {
  badge,
  button,
  card,
  confirmDialog,
  emptyState,
  h,
  list,
  openDialog,
  pageHeader,
  row,
  stat,
  Toast,
  withBusy,
} from '../lib/ui';
import { formatDayTime, formatShortDate, formatSize } from '../util/format';
import type { Page } from './Page';

export interface ToolsPageOptions {
  api: LauncherApi;
  openSettings: () => void;
}

const MIN_COMFORTABLE_MEMORY_MB = 8192;
const MEMORY_CRASH_PREFIX = 'Mémoire insuffisante';
const KEPT_BACKUPS = 10;

export class ToolsPage implements Page {
  readonly root: HTMLElement;
  private readonly api: LauncherApi;
  private readonly openSettings: () => void;
  private readonly javaTile = h('div', { className: 'tools-tile' });
  private readonly memoryTile = h('div', { className: 'tools-tile' });
  private readonly backupCard = card({
    title: 'Sauvegardes',
    meta: `Mondes et config, ${KEPT_BACKUPS} gardées`,
    flush: true,
    scroll: true,
  });
  private readonly crashCard = card({ title: 'Rapports de crash', flush: true, scroll: true });

  constructor(root: HTMLElement, options: ToolsPageOptions) {
    this.root = root;
    this.api = options.api;
    this.openSettings = options.openSettings;

    const backupNow = button({
      label: 'Sauvegarder maintenant',
      variant: 'primary',
      icon: DatabaseBackup,
      onClick: () => void this.createBackup(backupNow),
    });

    root.append(
      pageHeader({
        title: 'Outils',
        subtitle: 'Sauvegardes de tes mondes et diagnostic quand le jeu refuse de démarrer.',
        actions: [backupNow],
      }),
      h(
        'div',
        { className: 'tools-tiles' },
        this.tile(this.javaTile),
        this.tile(this.memoryTile),
      ),
      h('div', { className: 'tools-columns' }, this.backupCard.root, this.crashCard.root),
    );
  }

  enter(): void {
    void this.loadDiagnostics();
    void this.loadBackups();
    void this.loadCrashes();
  }

  private tile(content: HTMLElement): HTMLElement {
    return card({ body: [content] }).root;
  }

  private async loadDiagnostics(): Promise<void> {
    try {
      const [javas, config] = await Promise.all([this.api.listJava(), this.api.getConfig()]);
      this.renderJava(javas[0]);
      this.renderMemory(config.memoryMb);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private renderJava(candidate: { version: string; vendor: string } | undefined): void {
    this.javaTile.textContent = '';
    if (candidate) {
      const value = stat('Java', `Java ${candidate.version} détecté`);
      this.javaTile.append(value.root, badge(candidate.vendor, 'green'));
      return;
    }
    const value = stat('Java', 'Aucun Java détecté');
    this.javaTile.append(value.root, badge('Installé automatiquement au lancement', 'amber'));
  }

  private renderMemory(memoryMb: number): void {
    this.memoryTile.textContent = '';
    const gigabytes = (memoryMb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const low = memoryMb < MIN_COMFORTABLE_MEMORY_MB;
    const side = h('div', { className: 'tools-tile__side' });
    if (low) {
      side.append(
        badge('Trop peu', 'amber'),
        button({ label: 'Modifier', size: 'sm', onClick: () => this.openSettings() }),
      );
    } else {
      side.append(badge('Confortable', 'green'));
    }
    this.memoryTile.append(stat('RAM allouée', `${gigabytes} Go`).root, side);
  }

  private async loadBackups(): Promise<void> {
    try {
      const result = await this.api.listBackups();
      this.renderBackups(result.backups);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private async loadCrashes(): Promise<void> {
    try {
      const result = await this.api.listCrashes();
      this.renderCrashes(result.reports);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private async createBackup(trigger: HTMLButtonElement): Promise<void> {
    try {
      await withBusy(trigger, 'Sauvegarde…', () => this.api.createBackup());
      Toast.show('Sauvegarde créée', 'ok');
      await this.loadBackups();
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private renderBackups(backups: BackupEntry[]): void {
    this.backupCard.body.textContent = '';
    if (backups.length === 0) {
      this.backupCard.body.append(
        emptyState({
          icon: DatabaseBackup,
          title: 'Aucune sauvegarde',
          text: 'Utilise Sauvegarder maintenant pour protéger tes mondes.',
        }),
      );
      return;
    }
    this.backupCard.body.append(list(...backups.map((backup) => this.backupRow(backup))));
  }

  private backupRow(backup: BackupEntry): HTMLElement {
    return row({
      title: formatDayTime(backup.mtime),
      sub: backup.name,
      meta: formatSize(backup.size),
      actions: [
        button({
          label: 'Supprimer',
          size: 'sm',
          variant: 'ghost',
          icon: Trash2,
          onClick: () => void this.deleteBackup(backup),
        }),
      ],
    });
  }

  private async deleteBackup(backup: BackupEntry): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Supprimer la sauvegarde',
      text: `${backup.name} sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await this.api.deleteBackup(backup.name);
      this.renderBackups(result.backups);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private renderCrashes(reports: CrashReport[]): void {
    this.crashCard.body.textContent = '';
    if (reports.length === 0) {
      this.crashCard.body.append(
        emptyState({
          icon: FileText,
          title: 'Aucun crash détecté',
          text: 'Les rapports du jeu apparaîtront ici en cas de problème.',
        }),
      );
      return;
    }
    const latest = reports.reduce((newest, report) => (report.mtime > newest.mtime ? report : newest));
    if (latest.summary.startsWith(MEMORY_CRASH_PREFIX)) {
      this.crashCard.body.append(this.memoryAlert());
    }
    this.crashCard.body.append(list(...reports.map((report) => this.crashRow(report))));
  }

  private memoryAlert(): HTMLElement {
    return h(
      'div',
      { className: 'tools-alert' },
      h('span', { text: 'Le dernier crash vient d’un manque de mémoire. Augmente la RAM allouée.' }),
      button({ label: 'Ouvrir les paramètres', size: 'sm', onClick: () => this.openSettings() }),
    );
  }

  private crashRow(report: CrashReport): HTMLElement {
    return row({
      title: report.summary,
      sub: report.name,
      meta: formatShortDate(report.mtime),
      actions: [
        button({ label: 'Voir', size: 'sm', onClick: () => void this.openCrash(report) }),
        button({
          icon: Copy,
          size: 'sm',
          variant: 'ghost',
          title: 'Copier le rapport',
          onClick: () => void this.copyCrash(report),
        }),
        button({
          icon: FolderOpen,
          size: 'sm',
          variant: 'ghost',
          title: 'Afficher le fichier',
          onClick: () => void this.revealCrash(report),
        }),
        button({
          icon: Trash2,
          size: 'sm',
          variant: 'ghost',
          title: 'Supprimer',
          onClick: () => void this.deleteCrash(report),
        }),
      ],
    });
  }

  private async openCrash(report: CrashReport): Promise<void> {
    try {
      const content = await this.api.readCrash(report.name);
      openDialog({
        title: `${report.name} : ${report.summary}`,
        body: [h('pre', { className: 'ui-code', text: content })],
        wide: true,
      });
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private async copyCrash(report: CrashReport): Promise<void> {
    try {
      await this.api.copyCrash(report.name);
      Toast.show('Rapport copié, colle-le sur Discord.', 'ok');
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private async revealCrash(report: CrashReport): Promise<void> {
    try {
      await this.api.revealCrash(report.name);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }

  private async deleteCrash(report: CrashReport): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Supprimer le rapport',
      text: `${report.name} sera supprimé définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await this.api.deleteCrash(report.name);
      this.renderCrashes(result.reports);
    } catch (error) {
      Toast.show((error as Error).message, 'error');
    }
  }
}
