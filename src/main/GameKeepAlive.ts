const HIDE_DELAY_AFTER_GAME_SPAWN_MS = 2000;

export interface KeepAliveWindow {
  hide(): void;
  reveal(): void;
  close(): void;
}

export interface GameKeepAliveOptions {
  window: KeepAliveWindow;
  quit: () => void;
  quitsWhenLastWindowCloses: boolean;
}

export interface GameExit {
  crashed: boolean;
}

export class GameKeepAlive {
  private readonly window: KeepAliveWindow;
  private readonly quit: () => void;
  private readonly quitsWhenLastWindowCloses: boolean;
  private gameRunning = false;
  private hiddenForGame = false;
  private windowClosedDuringGame = false;
  private pendingHide: ReturnType<typeof setTimeout> | null = null;

  constructor({ window, quit, quitsWhenLastWindowCloses }: GameKeepAliveOptions) {
    this.window = window;
    this.quit = quit;
    this.quitsWhenLastWindowCloses = quitsWhenLastWindowCloses;
  }

  gameStarted(closeLauncherOnGameStart: boolean): void {
    this.gameRunning = true;
    if (!closeLauncherOnGameStart || this.pendingHide || this.hiddenForGame) return;
    this.pendingHide = setTimeout(() => {
      this.pendingHide = null;
      if (!this.gameRunning) return;
      this.hiddenForGame = true;
      this.window.hide();
    }, HIDE_DELAY_AFTER_GAME_SPAWN_MS);
  }

  lastGameExited({ crashed }: GameExit): void {
    this.gameRunning = false;
    if (this.pendingHide) clearTimeout(this.pendingHide);
    this.pendingHide = null;
    const hidden = this.hiddenForGame;
    const closed = this.windowClosedDuringGame;
    this.hiddenForGame = false;
    this.windowClosedDuringGame = false;

    if (crashed && (hidden || closed)) {
      this.window.reveal();
      return;
    }
    if (hidden) this.window.close();
    else if (closed && this.quitsWhenLastWindowCloses) this.quit();
  }

  allWindowsClosed(): void {
    if (this.gameRunning) {
      this.windowClosedDuringGame = true;
      return;
    }
    if (this.quitsWhenLastWindowCloses) this.quit();
  }

  windowRequested(): void {
    this.hiddenForGame = false;
    this.windowClosedDuringGame = false;
    this.window.reveal();
  }
}
