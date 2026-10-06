import { h, type Child } from './h';

export interface PageHeaderOptions {
  title: string;
  subtitle?: Child;
  actions?: Child[];
}

export function pageHeader(options: PageHeaderOptions): HTMLElement {
  return h(
    'header',
    { className: 'ui-page-head' },
    h(
      'div',
      {},
      h('h1', { className: 'ui-page-head__title', text: options.title }),
      options.subtitle !== undefined ? h('p', { className: 'ui-page-head__sub' }, options.subtitle) : null,
    ),
    options.actions?.length ? h('div', { className: 'ui-page-head__actions' }, ...options.actions) : null,
  );
}
