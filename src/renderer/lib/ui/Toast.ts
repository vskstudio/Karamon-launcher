import { h } from './h';
import { dot, type Tone } from './Badge';

export type ToastType = 'ok' | 'error' | 'info' | 'warn' | '';

const TONES: Record<ToastType, Tone> = { ok: 'green', error: 'red', warn: 'amber', info: 'neutral', '': 'neutral' };

export class Toast {
  static readonly FADE_MS = 300;
  static readonly DURATION_MS = 3000;

  static show(message: string, type: ToastType = ''): void {
    const el = h('div', { className: 'ui-toast', attrs: { role: 'status' } }, dot(TONES[type]), h('span', { text: message }));
    Toast.container().append(el);
    setTimeout(() => {
      el.classList.add('ui-toast--leaving');
      setTimeout(() => el.remove(), Toast.FADE_MS);
    }, Toast.DURATION_MS);
  }

  private static container(): HTMLElement {
    const existing = document.querySelector<HTMLElement>('.ui-toasts');
    if (existing) return existing;
    const created = h('div', { className: 'ui-toasts', attrs: { 'aria-live': 'polite' } });
    document.body.append(created);
    return created;
  }
}
