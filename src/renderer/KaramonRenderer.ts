import type { LauncherApi, MinecraftProfile } from '../ipc/contract';
import { $, $button, $opt } from './util/dom';
import { Toast, confirmDialog } from './lib/ui';
import { ConsoleView } from './components/ConsoleView';
import { ProgressBar } from './components/ProgressBar';
import { PlayButton } from './components/PlayButton';
import { ServerStatusPanel } from './components/ServerStatusPanel';
import { Navigation } from './components/Navigation';
import { WindowControls } from './components/WindowControls';
import { StatsView } from './components/StatsView';
import { Konami } from './components/Konami';
import { PlayersSparkline } from './components/PlayersSparkline';
import { QuickLinks } from './components/QuickLinks';
import { PackPage } from './pages/PackPage';
import { ToolsPage } from './pages/ToolsPage';
import { ScreenshotsPage } from './pages/ScreenshotsPage';
import { ShopPage } from './pages/ShopPage';
import { SettingsPage } from './pages/SettingsPage';
import type { Page } from './pages/Page';
import { AccountChip } from './components/AccountChip';
import type { PingResult } from '../ipc/contract';

export class KaramonRenderer {
  static readonly SERVER_PING_INTERVAL_MS = 30000;
  static readonly POKEBALL_ANIM_MS = 2200;

  private readonly api: LauncherApi;
  private readonly console: ConsoleView;
  private readonly progress: ProgressBar;
  private readonly playButton: PlayButton;
  private readonly serverStatus: ServerStatusPanel;
  private readonly stats: StatsView;
  private readonly sparkline: PlayersSparkline;
  private readonly pack: PackPage;
  private readonly settings: SettingsPage;
  private readonly pages: Record<string, Page>;
  private readonly accountChip: AccountChip;
  private gameRunning = false;
  private actionRunning = false;
  private authProfile: MinecraftProfile | null = null;

  constructor(api: LauncherApi) {
    this.api = api;
    this.console = new ConsoleView({
      linesEl: $('console-lines'),
      wrapEl: $('console-wrap'),
      progressLabel: $('progress-label'),
    });
    this.progress = new ProgressBar($('progress-bar'), $('progress-label'));
    this.playButton = new PlayButton($('btn-play'), $('play-label'));
    this.sparkline = new PlayersSparkline(
      document.getElementById('sparkline-path') as unknown as SVGPathElement,
    );
    this.serverStatus = new ServerStatusPanel({
      dotEl: $('status-dot'),
      textEl: $('status-text'),
      playersEl: $('server-players'),
      tooltipEl: $opt('players-tooltip'),
      ping: () => api.pingServer(),
      onResult: (r, prev) => this.onPingResult(r, prev),
    });
    this.stats = new StatsView(api);
    this.pack = new PackPage($('panel-mods'), {
      api,
      sync: () => this.syncMods(),
      repair: () => this.repair(),
    });
    this.settings = new SettingsPage($('panel-settings'), {
      api,
      onSaved: () => {
        Toast.show('Paramètres enregistrés.', 'ok');
        this.console.log('Paramètres enregistrés.', 'ok');
      },
      repair: () => this.repair(),
      onStatsChanged: () => void this.stats.refresh(),
    });
    this.pages = {
      mods: this.pack,
      tools: new ToolsPage($('panel-tools'), { api, openSettings: () => Navigation.go('settings') }),
      screenshots: new ScreenshotsPage($('panel-screenshots'), { api }),
      shop: new ShopPage($('panel-shop'), { api, playerName: () => this.authProfile?.name ?? null }),
      settings: this.settings,
    };
    this.accountChip = new AccountChip(
      $('account-chip'),
      () => void this.handleLogout(),
      (profileId) => api.skinUrl(profileId),
    );
  }

  private onPingResult(r: PingResult, prev: 'online' | 'offline' | 'unknown'): void {
    this.sparkline.push(r.online ? r.players : null);
    if (prev === 'unknown') return;
    if (r.online && prev === 'offline') {
      this.notify('Serveur en ligne', 'Karamon est de retour !');
    } else if (!r.online && prev === 'online') {
      this.notify('Serveur hors ligne', 'Karamon vient de s’arrêter.');
    }
  }

  private notify(title: string, body: string): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') new Notification(title, { body });
      });
    }
  }

  async start(): Promise<void> {
    Navigation.attach((panel) => this.onPanelChange(panel));
    WindowControls.attach(this.api);

    $('console-toggle').addEventListener('click', () => this.console.toggle());
    $('console-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.console.setOpen(false);
    });
    $('btn-logs-toggle').addEventListener('click', () => this.console.toggle());
    $('btn-play').addEventListener('click', () => this.play());
    $('btn-hero-sync').addEventListener('click', () => void this.syncMods());
    $('btn-folder').addEventListener('click', () => this.api.openInstance());
    $('btn-export-logs').addEventListener('click', (e) => this.exportLogs(e));
    $('btn-clear-logs').addEventListener('click', (e) => {
      e.stopPropagation();
      this.console.clear();
    });

    QuickLinks.render(this.api, $('nav-links'));
    this.wireIpcEvents();
    this.wireUpdateBar();
    this.wireRepairBar();
    Konami.attach(() => this.fireKonami());
    await this.refreshAuthState();

    this.console.log('Karamon Launcher démarré.', 'ok');

    void this.settings.load();
    void this.stats.refresh();
    void this.suggestPotatoMode();

    const setup = await this.api.setupMinecraft();
    this.console.log('Instance: ' + setup.path, setup.ok ? 'ok' : 'warn');
    this.console.log('Setup: ' + setup.details, setup.ok ? 'ok' : 'warn');

    await this.serverStatus.refresh();
    // No status ping while the game runs or the window is minimized/hidden.
    setInterval(() => {
      if (this.gameRunning || document.hidden) return;
      void this.serverStatus.refresh();
    }, KaramonRenderer.SERVER_PING_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.gameRunning) void this.serverStatus.refresh();
    });

    this.console.log('Prêt.', 'ok');
  }

  private onPanelChange(panel: string): void {
    if (panel === 'home') void this.stats.refresh();
    this.pages[panel]?.enter();
  }

  private fireKonami(): void {
    const overlay = $('pokeball-overlay');
    overlay.classList.remove('fire');
    void overlay.offsetWidth;
    overlay.classList.add('fire');
    setTimeout(() => overlay.classList.remove('fire'), KaramonRenderer.POKEBALL_ANIM_MS);
  }

  private wireIpcEvents(): void {
    this.api.onStatus((msg) => this.console.log(msg));
    this.api.onProgress((val) => this.progress.set(val));
    this.api.onGameState(({ running }) => {
      this.gameRunning = running;
      this.actionRunning = false;
      this.refreshPlayButton();
      if (running) {
        this.console.log('Launcher Minecraft ouvert !', 'ok');
        Toast.show('Launcher Minecraft ouvert !', 'ok');
        void this.stats.refresh();
      }
    });
  }

  private wireUpdateBar(): void {
    const bar = $('update-bar');
    const msg = $('update-msg');
    const installButton = $button('btn-install-update');
    installButton.addEventListener('click', () => this.api.installUpdate());
    $('btn-dismiss-update').addEventListener('click', () => bar.classList.remove('show'));
    this.api.onUpdateReady(({ version, install }) => {
      if (install === 'download') {
        msg.textContent = `Version ${version} disponible.`;
        installButton.textContent = 'Télécharger';
        this.console.log(`Version ${version} disponible, à installer depuis le .dmg.`, 'ok');
      } else {
        msg.textContent = `Mise à jour ${version} prête.`;
        this.console.log(`Mise à jour ${version} téléchargée.`, 'ok');
      }
      bar.classList.add('show');
    });
  }

  private refreshPlayButton(): void {
    if (this.actionRunning) return this.playButton.setLoading();
    if (this.gameRunning) return this.playButton.setRunning();
    if (!this.authProfile) return this.playButton.setLoginRequired();
    this.playButton.setIdle();
  }

  private async refreshAuthState(): Promise<void> {
    const session = await this.api.authGetSession();
    this.authProfile = session.signedIn ? session.profile : null;
    this.accountChip.render(this.authProfile);
    this.refreshPlayButton();
  }

  private async handleLogin(): Promise<void> {
    if (this.actionRunning) return;
    this.actionRunning = true;
    this.playButton.setLoading();
    try {
      const result = await this.api.authLogin();
      if (result.ok) {
        this.authProfile = result.profile;
        this.accountChip.render(this.authProfile);
        Toast.show(`Connecté en tant que ${result.profile.name}.`, 'ok');
        this.console.log(`Connecté : ${result.profile.name}`, 'ok');
      } else {
        Toast.show(result.error, 'error');
        this.console.log('Erreur connexion: ' + result.error, 'error');
      }
    } finally {
      this.actionRunning = false;
      this.refreshPlayButton();
    }
  }

  private async handleLogout(): Promise<void> {
    if (!this.authProfile) return;
    const ok = await confirmDialog({
      title: `Se déconnecter de ${this.authProfile.name} ?`,
      text: 'Il faudra te reconnecter avec Microsoft pour jouer.',
      confirmLabel: 'Se déconnecter',
      danger: true,
    });
    if (!ok) return;
    await this.api.authLogout();
    this.authProfile = null;
    this.accountChip.render(null);
    this.refreshPlayButton();
    Toast.show('Déconnecté.', 'ok');
  }

  private async play(): Promise<void> {
    if (this.actionRunning) return;
    if (!this.authProfile) {
      void this.handleLogin();
      return;
    }
    if (this.gameRunning) {
      Toast.show('Minecraft est déjà en cours.', 'error');
      return;
    }
    this.actionRunning = true;
    this.refreshPlayButton();
    this.console.log('Lancement en cours...', 'info');

    const result = await this.api.play();
    if (!result.ok) {
      this.actionRunning = false;
      this.refreshPlayButton();
      this.console.log('Erreur: ' + result.error, 'error');
      Toast.show(result.error, 'error');
    }
  }

  private async syncMods(): Promise<boolean> {
    const heroButton = $button('btn-hero-sync');
    heroButton.disabled = true;
    this.console.log('Synchronisation du pack en cours...', 'info');
    const result = await this.api.syncMods();
    heroButton.disabled = false;
    if (result.ok) {
      this.console.log('Pack synchronisé avec succès.', 'ok');
      Toast.show('Pack mis à jour.', 'ok');
      void this.pack.reload();
      return true;
    }
    this.console.log('Erreur sync pack: ' + result.error, 'error');
    Toast.show(result.error, 'error');
    return false;
  }

  private async repair(): Promise<boolean> {
    this.console.log("Réparation de l'installation en cours...", 'info');
    const result = await this.api.repair();
    if (result.ok) {
      this.console.log(result.summary, 'ok');
      Toast.show(result.summary, 'ok');
      return true;
    }
    this.console.log('Erreur réparation: ' + result.error, 'error');
    Toast.show(result.error, 'error');
    return false;
  }

  private wireRepairBar(): void {
    const bar = $('repair-bar');
    const msg = $('repair-msg');
    $('btn-dismiss-repair').addEventListener('click', () => bar.classList.remove('show'));
    $('btn-repair-relaunch').addEventListener('click', () => {
      bar.classList.remove('show');
      void this.play();
    });
    this.api.onRepairOffer(({ result }) => {
      if (result.ok) {
        msg.textContent = `Le jeu a planté sur des fichiers abîmés. ${result.summary}`;
        this.console.log('Réparation automatique terminée : ' + result.summary, 'ok');
      } else {
        msg.textContent = 'Le jeu a planté sur des fichiers abîmés, la réparation a échoué.';
        this.console.log('Réparation automatique échouée : ' + result.error, 'error');
      }
      bar.classList.add('show');
    });
  }

  /** Once, on a PC that looks modest: offers the mode PC modeste. Never turns it on by itself. */
  private async suggestPotatoMode(): Promise<void> {
    const [config, system] = await Promise.all([this.api.getConfig(), this.api.systemInfo()]);
    if (config.potatoMode || config.potatoHintDismissed || system.lowEndReasons.length === 0) return;
    const bar = $('potato-bar');
    $('potato-msg').textContent =
      `Ton PC semble modeste (${system.lowEndReasons.join(', ')}). Le mode PC modeste coupe les shaders et allège le jeu.`;
    const answer = async (potatoMode: boolean): Promise<void> => {
      bar.classList.remove('show');
      await this.api.saveConfig(potatoMode ? { potatoMode, potatoHintDismissed: true } : { potatoHintDismissed: true });
      await this.settings.load();
      if (potatoMode) {
        Toast.show('Mode PC modeste activé. Tu peux le couper dans les paramètres.', 'ok');
        this.console.log('Mode PC modeste activé.', 'ok');
      }
    };
    $('btn-potato-enable').addEventListener('click', () => void answer(true));
    $('btn-potato-dismiss').addEventListener('click', () => void answer(false));
    bar.classList.add('show');
  }

  private async exportLogs(e: Event): Promise<void> {
    e.stopPropagation();
    const result = await this.api.exportLogs(this.console.joined());
    if (result.ok) Toast.show('Logs exportés.', 'ok');
  }
}
