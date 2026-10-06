import { h, cx } from './h';
import { icon, type IconNode } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconNode;
  title?: string;
  id?: string;
  block?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return cx('ui-btn', variant !== 'secondary' && `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`);
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const size = options.size ?? 'md';
  const iconOnly = !options.label;
  const btn = h('button', {
    className: cx(
      buttonClass(options.variant, size),
      iconOnly && 'ui-btn--icon',
      options.block && 'ui-btn--block',
    ),
    id: options.id,
    title: options.title,
    attrs: { type: 'button', ...(iconOnly && options.title ? { 'aria-label': options.title } : {}) },
  });
  if (options.icon) btn.append(icon(options.icon, size === 'sm' ? 14 : 16));
  if (options.label) btn.append(h('span', { className: 'ui-btn__label', text: options.label }));
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return btn;
}

export function setButtonLabel(btn: HTMLButtonElement, label: string): void {
  const span = btn.querySelector('.ui-btn__label');
  if (span) span.textContent = label;
  else btn.textContent = label;
}

export async function withBusy<T>(
  btn: HTMLButtonElement,
  busyLabel: string,
  task: () => Promise<T>,
): Promise<T> {
  const span = btn.querySelector('.ui-btn__label');
  const idle = span?.textContent ?? btn.textContent ?? '';
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  setButtonLabel(btn, busyLabel);
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    setButtonLabel(btn, idle);
  }
}
