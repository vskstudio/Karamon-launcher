import { RefreshCw, Wrench } from 'lucide';
import type { AppConfig, AppConfigUpdate, LauncherApi, PlayStats, SystemInfo } from '../../ipc/contract';
import {
  badge,
  button,
  card,
  confirmDialog,
  dot,
  field,
  fieldRow,
  h,
  pageHeader,
  rangeInput,
  selectInput,
  setButtonLabel,
  setSelectOptions,
  settingRow,
  stat,
  stats,
  syncRangeFill,
  textInput,
  toggle,
  Toast,
  withBusy,
  type Field,
  type SelectOption,
} from '../lib/ui';

type Toggle = ReturnType<typeof toggle>;
import { JVM_PRESETS } from '../util/jvmPresets';
import { formatDuration, formatNumber, formatShortDate } from '../util/format';
import type { Page } from './Page';
import './SettingsPage.css';

export interface SettingsPageOptions {
  api: LauncherApi;
  onSaved: () => void;
  repair: () => Promise<boolean>;
  onStatsChanged: () => void;
}

const DEFAULT_MEMORY_MB = 12288;
const MIN_MEMORY_MB = 2048;
const MEMORY_STEP_MB = 512;
const RECOMMENDED_MIN_MB = 8192;
const RECOMMENDED_MAX_MB = 12288;
const AUTO_JAVA = '';
const CUSTOM_JAVA = '__custom__';
const CUSTOM_PRESET = 'custom';

export class SettingsPage implements Page {
  readonly root: HTMLElement;
  private readonly api: LauncherApi;
  private readonly options: SettingsPageOptions;

  private readonly memoryValue = h('span', { className: 'settings-memory__value' });
  private readonly memoryTotal = h('span', { className: 'settings-memory__total' });
  private memoryBadge: HTMLElement = h('span');
  private readonly memoryHint = h('span', { className: 'ui-field__hint' });
  private readonly memoryRange: HTMLInputElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly jvmArgs: HTMLInputElement;
  private readonly javaSelect: HTMLSelectElement;
  private readonly javaPath: HTMLInputElement;
  private readonly javaPathField: Field;
  private readonly gameDir: HTMLInputElement;
  private readonly closeOnLaunch: Toggle;
  private readonly devMode: Toggle;
  private readonly disableSodium: Toggle;
  private readonly potatoMode: Toggle;
  private potatoBadge: HTMLElement = h('span');
  private readonly potatoMemory = h('li');
  private potatoHintDismissed = false;

  private readonly statPlaytime = stat('Temps de jeu');
  private readonly statSessions = stat('Sessions');
  private readonly statFirst = stat('Première fois');
  private readonly sysRam = stat('RAM');
  private readonly sysCpu = stat('Processeur');
  private readonly sysOs = stat('Système');
  private readonly versionLabel = h('span', { className: 'settings-version__name', text: 'Launcher' });
  private readonly updateStatus = h('span', { className: 'settings-version__status', text: 'Vérifie si une nouvelle version existe.' });
  private readonly updateButton: HTMLButtonElement;
  private updateMode: 'check' | 'install' = 'check';

  private readonly saveBar: HTMLElement;
  private readonly saveCount = h('span');
  private readonly saveButton: HTMLButtonElement;

  private system: SystemInfo | null = null;
  private saved: AppConfigUpdate | null = null;

  constructor(root: HTMLElement, options: SettingsPageOptions) {
    this.root = root;
    this.api = options.api;
    this.options = options;

    this.memoryRange = rangeInput({
      min: MIN_MEMORY_MB,
      max: 16384,
      step: MEMORY_STEP_MB,
      value: DEFAULT_MEMORY_MB,
      label: 'Mémoire allouée',
      onInput: () => {
        this.renderMemory();
        this.markDirty();
      },
    });

    this.presetSelect = selectInput({
      items: JVM_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
      onChange: (id) => {
        const preset = JVM_PRESETS.find((candidate) => candidate.id === id);
        if (preset && preset.id !== CUSTOM_PRESET) this.jvmArgs.value = preset.args;
        if (id === CUSTOM_PRESET) this.jvmArgs.focus();
        this.markDirty();
      },
    });
    this.jvmArgs = textInput({
      mono: true,
      placeholder: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50',
      onInput: () => {
        this.syncPresetFromArgs();
        this.markDirty();
      },
    });

    this.javaSelect = selectInput({
      onChange: (value) => {
        this.javaPathField.root.hidden = value !== CUSTOM_JAVA;
        if (value !== CUSTOM_JAVA) this.javaPath.value = value;
        else this.javaPath.focus();
        this.markDirty();
      },
    });
    this.javaPath = textInput({ mono: true, placeholder: '/chemin/vers/java', onInput: () => this.markDirty() });
    this.javaPathField = field({ label: 'Chemin de Java', control: this.javaPath });
    this.javaPathField.root.hidden = true;

    this.gameDir = textInput({
      mono: true,
      placeholder: 'Dossier du launcher (par défaut)',
      onInput: () => this.markDirty(),
    });

    this.closeOnLaunch = toggle({ label: 'Fermer le launcher au lancement du jeu', onChange: () => this.markDirty() });
    this.devMode = toggle({ label: 'Mode développement', onChange: () => this.markDirty() });
    this.disableSodium = toggle({ label: 'Désactiver Sodium', onChange: () => this.markDirty() });
    this.potatoMode = toggle({
      label: 'Mode PC modeste',
      onChange: () => {
        this.renderMemory();
        this.markDirty();
      },
    });

    this.updateButton = button({
      label: 'Vérifier les mises à jour',
      icon: RefreshCw,
      onClick: () => void this.checkUpdate(),
    });

    this.saveButton = button({ label: 'Enregistrer', variant: 'primary', onClick: () => void this.save() });
    this.saveBar = h(
      'div',
      { className: 'settings-savebar', attrs: { role: 'status' } },
      dot('amber'),
      this.saveCount,
      button({ label: 'Annuler', variant: 'ghost', onClick: () => this.revert() }),
      this.saveButton,
    );
    this.saveBar.hidden = true;

    root.append(
      pageHeader({ title: 'Paramètres', subtitle: 'Mémoire, Java et dossiers du jeu.' }),
      h(
        'div',
        { className: 'settings-layout' },
        h(
          'div',
          { className: 'settings-col' },
          this.memoryCard(),
          this.potatoCard(),
          this.behaviourCard(),
          this.maintenanceCard(),
        ),
        h('div', { className: 'settings-col' }, this.javaCard(), this.systemCard(), this.activityCard(), this.versionCard()),
      ),
      this.saveBar,
    );
  }

  enter(): void {
    void this.refreshStats();
  }

  async load(): Promise<void> {
    const [config, system] = await Promise.all([this.api.getConfig(), this.api.systemInfo()]);
    this.applySystem(system);
    this.applyConfig(config);
    await this.populateJava();
    this.saved = this.collect();
    this.markDirty();
    await this.refreshStats();
  }

  private memoryCard(): HTMLElement {
    const head = h(
      'div',
      { className: 'settings-memory' },
      this.memoryValue,
      this.memoryTotal,
    );
    const scale = h(
      'div',
      { className: 'settings-memory__scale' },
      h('span', { text: `${MIN_MEMORY_MB / 1024} Go` }),
      h('span', { text: `${RECOMMENDED_MIN_MB / 1024} à ${RECOMMENDED_MAX_MB / 1024} Go recommandés` }),
      h('span', { className: 'settings-memory__max' }),
    );
    const presetField = field({
      label: 'Arguments JVM',
      control: this.presetSelect,
      hint: 'Garde le préréglage recommandé sauf si tu sais ce que tu changes.',
    });
    return card({
      title: 'Mémoire allouée',
      actions: [this.memoryBadge],
      body: [
        head,
        this.memoryRange,
        scale,
        this.memoryHint,
        h('div', { className: 'settings-divider' }),
        presetField.root,
        this.jvmArgs,
      ],
    }).root;
  }

  private potatoCard(): HTMLElement {
    const changes = h(
      'ul',
      { className: 'settings-potato__list' },
      h('li', { text: 'Shaders coupés à chaque lancement. Tu peux les rallumer en jeu, ton shader reste sélectionné.' }),
      h('li', {
        text: 'Graphismes au minimum : distance de rendu 6 et simulation 5 (comme le serveur), mode rapide, sans nuages, ombres ni flou des menus, particules minimales, feuilles rapides. Un réglage déjà plus bas n’est jamais remonté.',
      }),
      h('li', {
        text: 'Mods visuels lourds désactivés : Voxy (vue lointaine), Particular, Particle Rain et Sound Physics. Ils ne servent qu’à l’affichage et au son, le serveur ne les demande pas.',
      }),
      this.potatoMemory,
    );
    return card({
      title: 'Mode PC modeste',
      actions: [this.potatoBadge],
      flush: true,
      body: [
        settingRow({
          label: 'Activer le mode PC modeste',
          hint: 'Pour les petites configs. Quand tu le coupes, tes réglages et les mods reviennent comme avant.',
          control: this.potatoMode.root,
        }),
        changes,
      ],
    }).root;
  }

  private maintenanceCard(): HTMLElement {
    const repairButton = button({
      label: "Réparer l'installation",
      icon: Wrench,
      onClick: () => void withBusy(repairButton, 'Vérification…', this.options.repair),
    });
    return card({
      flush: true,
      body: [
        settingRow({
          label: 'Maintenance',
          hint: 'Revérifie chaque fichier du pack, retélécharge ceux qui sont abîmés et répare les configs vides. Utile si le jeu plante au démarrage.',
          control: repairButton,
        }),
      ],
    }).root;
  }

  private behaviourCard(): HTMLElement {
    return card({
      flush: true,
      body: [
        settingRow({
          label: 'Fermer le launcher au lancement du jeu',
          hint: 'Il se rouvre quand tu quittes Minecraft.',
          control: this.closeOnLaunch.root,
        }),
        settingRow({
          label: 'Désactiver Sodium',
          hint: "Si le jeu plante ou reste bloqué au démarrage. Coupe aussi Iris (plus de shaders), Voxy (plus de terrain lointain), Sodium Extra et Reese's Sodium Options, donc moins de FPS. Pris en compte au prochain lancement, décoche pour tout remettre.",
          control: this.disableSodium.root,
        }),
        settingRow({
          label: 'Mode développement',
          hint: h(
            'span',
            {},
            'Affiche « Serveurs (dev) » sur l’écran titre pour rejoindre un serveur local. Aussi avec ',
            h('code', { text: '--dev' }),
            '.',
          ),
          control: this.devMode.root,
        }),
      ],
    }).root;
  }

  private javaCard(): HTMLElement {
    const rescan = button({
      label: 'Rescanner',
      icon: RefreshCw,
      onClick: () => void withBusy(rescan, 'Recherche…', () => this.populateJava()),
    });
    return card({
      title: 'Java et dossiers',
      body: [
        h(
          'div',
          { className: 'settings-stack' },
          field({
            label: 'Java',
            control: fieldRow(this.javaSelect, rescan),
            hint: 'Java 21 est installé automatiquement s’il manque.',
          }).root,
          this.javaPathField.root,
          field({
            label: 'Dossier du jeu',
            control: this.gameDir,
            hint: 'Laisse vide pour utiliser le dossier du launcher.',
          }).root,
        ),
      ],
    }).root;
  }

  private systemCard(): HTMLElement {
    return card({ title: 'Ce PC', body: [stats(this.sysRam, this.sysCpu, this.sysOs)] }).root;
  }

  private activityCard(): HTMLElement {
    const reset = button({
      label: 'Réinitialiser',
      variant: 'ghost',
      size: 'sm',
      onClick: () => void this.resetStats(),
    });
    return card({
      title: 'Ton activité',
      actions: [reset],
      body: [stats(this.statPlaytime, this.statSessions, this.statFirst)],
    }).root;
  }

  private versionCard(): HTMLElement {
    const logo = h('img', { className: 'settings-version__logo', attrs: { src: '../assets/ui/logo.png', alt: '' } });
    return card({
      body: [
        h(
          'div',
          { className: 'settings-version' },
          logo,
          h('div', { className: 'settings-version__text' }, this.versionLabel, this.updateStatus),
          this.updateButton,
        ),
      ],
    }).root;
  }

  private applySystem(system: SystemInfo): void {
    this.system = system;
    const totalGo = Math.round(system.totalMemMb / 1024);
    this.sysRam.value.textContent = `${totalGo} Go`;
    this.sysCpu.value.textContent = `${system.cpuCount} threads`;
    this.sysOs.value.textContent = SettingsPage.platformName(system.platform);
    this.sysOs.value.title = `${system.platform} ${system.arch}`;
    this.versionLabel.textContent = `Launcher ${system.appVersion}`;

    const max = Math.max(RECOMMENDED_MAX_MB, Math.floor(system.totalMemMb / MEMORY_STEP_MB) * MEMORY_STEP_MB);
    this.memoryRange.max = String(max);
    syncRangeFill(this.memoryRange);
    const maxLabel = this.root.querySelector('.settings-memory__max');
    if (maxLabel) maxLabel.textContent = `${Math.round(max / 1024)} Go`;

    const cap = system.potatoMemoryCapMb;
    this.potatoMemory.textContent =
      cap === null
        ? 'Mémoire : ton réglage est gardé.'
        : `Mémoire limitée à ${SettingsPage.formatGo(cap)} au plus (ton PC a ${totalGo} Go de RAM), pour laisser de la place au système. Un réglage plus bas est gardé.`;
    const suggested = system.lowEndReasons.length > 0;
    this.potatoBadge.replaceWith((this.potatoBadge = suggested ? badge('Conseillé pour ce PC', 'amber') : h('span')));
    if (suggested) this.potatoBadge.title = system.lowEndReasons.join(', ');
  }

  private applyConfig(config: AppConfig): void {
    this.setMemory(config.memoryMb || DEFAULT_MEMORY_MB);
    this.jvmArgs.value = config.jvmArgs ?? '';
    this.syncPresetFromArgs();
    this.javaPath.value = config.javaPath ?? '';
    this.gameDir.value = config.mcGameDir ?? '';
    this.closeOnLaunch.input.checked = config.closeLauncherOnGameStart ?? false;
    this.devMode.input.checked = config.devMode ?? false;
    this.disableSodium.input.checked = config.disableSodium ?? false;
    this.potatoMode.input.checked = config.potatoMode ?? false;
    this.potatoHintDismissed = config.potatoHintDismissed ?? false;
    this.renderMemory();
  }

  private setMemory(mb: number): void {
    this.memoryRange.value = String(mb);
    syncRangeFill(this.memoryRange);
    this.renderMemory();
  }

  private renderMemory(): void {
    const mb = Number(this.memoryRange.value);
    this.memoryValue.textContent = SettingsPage.formatGo(mb);
    const total = this.system?.totalMemMb ?? 0;
    this.memoryTotal.textContent = total ? `sur ${Math.round(total / 1024)} Go de RAM` : '';

    let label = 'Recommandé';
    let tone: 'green' | 'amber' | 'red' = 'green';
    let hint = '';
    if (total && mb > total) {
      label = 'Trop élevé';
      tone = 'red';
      hint = 'Plus que la RAM de ton PC, Minecraft ne pourra pas démarrer.';
    } else if (total && mb / total > 0.75) {
      label = 'Élevé';
      tone = 'amber';
      hint = `${Math.round((mb / total) * 100)} % de ta RAM, le reste du PC risque de ramer.`;
    } else if (mb < RECOMMENDED_MIN_MB) {
      label = 'Trop peu';
      tone = 'amber';
      hint = 'Sous 8 Go, le pack risque de manquer de mémoire.';
    } else if (mb > RECOMMENDED_MAX_MB) {
      label = 'Généreux';
      tone = 'green';
    }
    const cap = this.system?.potatoMemoryCapMb ?? null;
    if (this.potatoMode.input.checked && cap !== null && cap < mb) {
      label = 'Mode PC modeste';
      tone = 'amber';
      hint = `Mode PC modeste actif : le jeu démarre avec ${SettingsPage.formatGo(cap)} tant qu’il reste allumé.`;
    }
    this.memoryBadge.replaceWith((this.memoryBadge = badge(label, tone)));
    this.memoryHint.textContent = hint;
    this.memoryHint.hidden = !hint;
    this.memoryHint.classList.toggle('ui-field__hint--warn', tone !== 'green');
  }

  private syncPresetFromArgs(): void {
    const args = this.jvmArgs.value.trim();
    const match = JVM_PRESETS.find((preset) => preset.id !== CUSTOM_PRESET && preset.args === args);
    this.presetSelect.value = match ? match.id : CUSTOM_PRESET;
  }

  private async populateJava(): Promise<void> {
    const current = this.javaPath.value.trim();
    let candidates: { path: string; version: string; vendor: string }[] = [];
    try {
      candidates = await this.api.listJava();
    } catch {
      candidates = [];
    }
    const items: SelectOption[] = [
      { value: AUTO_JAVA, label: 'Automatique (recommandé)' },
      ...candidates.map((java) => ({ value: java.path, label: `Java ${java.version}, ${java.vendor}` })),
      { value: CUSTOM_JAVA, label: 'Autre chemin…' },
    ];
    setSelectOptions(this.javaSelect, items);
    const known = current === AUTO_JAVA || candidates.some((java) => java.path === current);
    this.javaSelect.value = known ? current : CUSTOM_JAVA;
    this.javaPathField.root.hidden = known;
  }

  private collect(): AppConfigUpdate {
    return {
      memoryMb: Number(this.memoryRange.value) || DEFAULT_MEMORY_MB,
      jvmArgs: this.jvmArgs.value.trim(),
      javaPath: this.javaPath.value.trim(),
      mcGameDir: this.gameDir.value.trim(),
      closeLauncherOnGameStart: this.closeOnLaunch.input.checked,
      devMode: this.devMode.input.checked,
      disableSodium: this.disableSodium.input.checked,
      potatoMode: this.potatoMode.input.checked,
    };
  }

  private changedCount(): number {
    if (!this.saved) return 0;
    const now = this.collect();
    const before = this.saved;
    return (Object.keys(now) as (keyof AppConfigUpdate)[]).filter((key) => now[key] !== before[key]).length;
  }

  private markDirty(): void {
    const count = this.changedCount();
    this.saveBar.hidden = count === 0;
    this.saveCount.textContent =
      count === 1 ? '1 modification non enregistrée' : `${formatNumber(count)} modifications non enregistrées`;
  }

  private revert(): void {
    if (!this.saved) return;
    this.setMemory(this.saved.memoryMb ?? DEFAULT_MEMORY_MB);
    this.jvmArgs.value = this.saved.jvmArgs ?? '';
    this.syncPresetFromArgs();
    this.javaPath.value = this.saved.javaPath ?? '';
    this.gameDir.value = this.saved.mcGameDir ?? '';
    this.closeOnLaunch.input.checked = this.saved.closeLauncherOnGameStart ?? false;
    this.devMode.input.checked = this.saved.devMode ?? false;
    this.disableSodium.input.checked = this.saved.disableSodium ?? false;
    this.potatoMode.input.checked = this.saved.potatoMode ?? false;
    this.renderMemory();
    void this.populateJava();
    this.markDirty();
  }

  private async save(): Promise<void> {
    const updates: AppConfigUpdate = this.collect();
    // Answering in the settings counts as answering the suggestion.
    if (updates.potatoMode !== this.saved?.potatoMode && !this.potatoHintDismissed) {
      updates.potatoHintDismissed = true;
      this.potatoHintDismissed = true;
    }
    try {
      await withBusy(this.saveButton, 'Enregistrement…', () => this.api.saveConfig(updates));
    } catch (error) {
      Toast.show(`Enregistrement impossible : ${String(error)}`, 'error');
      return;
    }
    this.saved = updates;
    this.markDirty();
    this.options.onSaved();
  }

  private async refreshStats(): Promise<void> {
    this.renderStats(await this.api.getStats());
  }

  private async resetStats(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Réinitialiser ton activité ?',
      text: 'Le temps de jeu et le nombre de sessions repartent de zéro.',
      confirmLabel: 'Réinitialiser',
      danger: true,
    });
    if (!ok) return;
    this.renderStats(await this.api.resetStats());
    this.options.onStatsChanged();
    Toast.show('Activité réinitialisée.', 'ok');
  }

  private renderStats(playStats: PlayStats): void {
    this.statPlaytime.value.textContent = formatDuration(playStats.totalPlayMs);
    this.statSessions.value.textContent = formatNumber(playStats.sessions);
    this.statFirst.value.textContent = playStats.firstPlayedAt ? formatShortDate(playStats.firstPlayedAt) : 'Jamais';
  }

  private async checkUpdate(): Promise<void> {
    if (this.updateMode === 'install') {
      this.api.installUpdate();
      return;
    }
    this.updateStatus.className = 'settings-version__status';
    const result = await withBusy(this.updateButton, 'Vérification…', () => this.api.checkForUpdate());
    switch (result.status) {
      case 'no-update':
        this.setUpdateStatus(`À jour, version ${result.currentVersion}.`, 'ok');
        break;
      case 'downloading':
        this.setUpdateStatus(`Version ${result.version} en cours de téléchargement.`, '');
        break;
      case 'downloaded':
        this.setUpdateStatus(`Version ${result.version} prête.`, 'ok');
        this.updateMode = 'install';
        setButtonLabel(this.updateButton, 'Redémarrer');
        break;
      case 'available':
        this.setUpdateStatus(`Version ${result.version} disponible, installe le .dmg de la dernière release.`, '');
        this.updateMode = 'install';
        setButtonLabel(this.updateButton, 'Télécharger');
        break;
      case 'unsupported':
        this.setUpdateStatus('Indisponible en mode développement.', '');
        break;
      case 'error':
        this.setUpdateStatus(`Erreur : ${result.error}`, 'error');
        break;
    }
  }

  private setUpdateStatus(text: string, tone: 'ok' | 'error' | ''): void {
    this.updateStatus.textContent = text;
    this.updateStatus.className = tone ? `settings-version__status settings-version__status--${tone}` : 'settings-version__status';
  }

  private static formatGo(mb: number): string {
    const go = mb / 1024;
    return `${go.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
  }

  private static platformName(platform: string): string {
    if (platform === 'win32') return 'Windows';
    if (platform === 'darwin') return 'macOS';
    if (platform === 'linux') return 'Linux';
    return platform;
  }
}
