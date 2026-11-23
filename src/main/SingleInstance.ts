export interface InstanceLockHost {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): unknown;
  quit(): void;
}

export class SingleInstance {
  private onRelaunch: (() => void) | null = null;

  static claim(host: InstanceLockHost): SingleInstance | null {
    if (!host.requestSingleInstanceLock()) {
      host.quit();
      return null;
    }
    const lock = new SingleInstance();
    host.on('second-instance', () => lock.onRelaunch?.());
    return lock;
  }

  whenRelaunched(handler: () => void): void {
    this.onRelaunch = handler;
  }
}
