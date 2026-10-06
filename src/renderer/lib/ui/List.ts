import { h, type Child } from './h';

export interface RowOptions {
  leading?: Child;
  title: string;
  sub?: string;
  meta?: Child;
  actions?: Child[];
  extra?: Child[];
}

export function list(...rows: Child[]): HTMLDivElement {
  return h('div', { className: 'ui-list', attrs: { role: 'list' } }, ...rows);
}

export function row(options: RowOptions): HTMLDivElement {
  const main = h(
    'div',
    { className: 'ui-row__main' },
    h('span', { className: 'ui-row__title', text: options.title, title: options.title }),
    options.sub ? h('span', { className: 'ui-row__sub', text: options.sub, title: options.sub }) : null,
  );
  return h(
    'div',
    { className: 'ui-row', attrs: { role: 'listitem' } },
    options.leading,
    main,
    ...(options.extra ?? []),
    options.meta !== undefined ? h('span', { className: 'ui-row__meta' }, options.meta) : null,
    options.actions?.length ? h('div', { className: 'ui-row__actions' }, ...options.actions) : null,
  );
}
