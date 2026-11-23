import type { GameInstance } from '../../shared/GameInstance.ts';

export class GameRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameRunningError';
  }
}

export class InstanceSession {
  readonly instance: GameInstance;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<unknown>>();
  private games = 0;

  constructor(instance: GameInstance) {
    this.instance = instance;
  }

  get gameRunning(): boolean {
    return this.games > 0;
  }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => undefined);
    return run;
  }

  whileGameClosed<T>(refusal: string, operation: () => Promise<T>): Promise<T> {
    return this.exclusive(() => {
      if (this.gameRunning) throw new GameRunningError(refusal);
      return operation();
    });
  }

  joined<T>(name: string, start: () => Promise<T>): Promise<T> {
    const running = this.pending.get(name) as Promise<T> | undefined;
    if (running) return running;
    const run = start().finally(() => this.pending.delete(name));
    this.pending.set(name, run);
    return run;
  }

  gameStarted(): () => void {
    this.games++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.games--;
    };
  }
}
