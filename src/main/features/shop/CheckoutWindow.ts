import { BrowserWindow, session } from 'electron/main';
import { randomUUID } from 'crypto';
import { classifyCheckoutUrl } from './CheckoutNavigation.ts';

export type CheckoutOutcome = 'paid' | 'cancelled' | 'failed';

const CHECKOUT_WINDOW_TITLE = 'Paiement sécurisé';
const CHECKOUT_WINDOW_WIDTH = 520;
const CHECKOUT_WINDOW_HEIGHT = 760;
const NAVIGATION_ABORTED = -3;

export function openCheckoutWindow(parent: BrowserWindow | null, checkoutUrl: string): Promise<CheckoutOutcome> {
  return new Promise((resolve) => {
    const partition = `karamon-checkout-${randomUUID()}`;
    const checkoutSession = session.fromPartition(partition, { cache: false });
    checkoutSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    checkoutSession.setPermissionCheckHandler(() => false);

    const window = new BrowserWindow({
      parent: parent ?? undefined,
      modal: parent !== null,
      width: CHECKOUT_WINDOW_WIDTH,
      height: CHECKOUT_WINDOW_HEIGHT,
      minWidth: 420,
      minHeight: 560,
      title: CHECKOUT_WINDOW_TITLE,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        safeDialogs: true,
      },
    });
    window.removeMenu();

    let settled = false;
    const settle = (outcome: CheckoutOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
      if (!window.isDestroyed()) window.close();
    };

    const guardNavigation = (event: { url: string; isMainFrame: boolean; preventDefault(): void }): void => {
      if (!event.isMainFrame) return;
      const verdict = classifyCheckoutUrl(event.url);
      if (verdict === 'allowed') return;
      event.preventDefault();
      if (verdict === 'paid' || verdict === 'cancelled') settle(verdict);
    };

    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== NAVIGATION_ABORTED) settle('failed');
    });
    window.on('page-title-updated', (event) => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      settle('cancelled');
      void checkoutSession.clearStorageData().catch(() => undefined);
    });

    window.loadURL(checkoutUrl).catch(() => undefined);
  });
}
