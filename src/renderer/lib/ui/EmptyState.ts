import { h, type Child } from './h';
import { icon, type IconNode } from './Icon';

export interface EmptyStateOptions {
  icon?: IconNode;
  title: string;
  text?: string;
  action?: Child;
}

export function emptyState(options: EmptyStateOptions): HTMLDivElement {
  return h(
    'div',
    { className: 'ui-empty' },
    options.icon ? icon(options.icon, 22) : null,
    h('p', { className: 'ui-empty__title', text: options.title }),
    options.text ? h('p', { className: 'ui-empty__text', text: options.text }) : null,
    options.action,
  );
}
