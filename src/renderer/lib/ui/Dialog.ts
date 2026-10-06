import { X } from 'lucide';
import { h, cx, type Child } from './h';
import { button } from './Button';

export interface DialogOptions {
  title: string;
  body: Child[];
  foot?: Child[];
  wide?: boolean;
  onClose?: () => void;
}

export interface Dialog {
  root: HTMLElement;
  close(): void;
}

export function openDialog(options: DialogOptions): Dialog {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const closeButton = button({ icon: X, variant: 'ghost', size: 'sm', title: 'Fermer' });
  const panel = h(
    'div',
    {
      className: cx('ui-dialog', options.wide && 'ui-dialog--wide'),
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
    },
    h('header', { className: 'ui-dialog__head' }, h('h2', { className: 'ui-dialog__title', text: options.title }), closeButton),
    h('div', { className: cx('ui-dialog__body', options.wide && 'ui-dialog__body--fill') }, ...options.body),
    options.foot ? h('footer', { className: 'ui-dialog__foot' }, ...options.foot) : null,
  );
  const scrim = h('div', { className: 'ui-scrim' }, panel);

  let closed = false;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    scrim.remove();
    previousFocus?.focus();
    options.onClose?.();
  };

  closeButton.addEventListener('click', close);
  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  (panel.querySelector<HTMLElement>('.ui-dialog__foot .ui-btn:last-child') ?? closeButton).focus();
  return { root: panel, close };
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  danger?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const cancel = button({ label: 'Annuler', variant: 'ghost', onClick: () => dialog.close() });
    const confirm = button({
      label: options.confirmLabel,
      variant: options.danger ? 'danger' : 'primary',
      onClick: () => {
        answer = true;
        dialog.close();
      },
    });
    const dialog = openDialog({
      title: options.title,
      body: options.text ? [h('p', { text: options.text })] : [],
      foot: [cancel, confirm],
      onClose: () => resolve(answer),
    });
  });
}
