import { h, cx, append, type Child } from './h';

export interface CardOptions {
  title?: string;
  meta?: Child;
  actions?: Child[];
  body?: Child[];
  flush?: boolean;
  scroll?: boolean;
  foot?: Child[];
  className?: string;
}

export interface Card {
  root: HTMLElement;
  body: HTMLElement;
  meta: HTMLElement | null;
}

export function card(options: CardOptions): Card {
  const root = h('section', { className: cx('ui-card', options.className) });
  let meta: HTMLElement | null = null;
  if (options.title !== undefined) {
    const side = h('div', { className: 'ui-card__actions' });
    if (options.meta !== undefined) {
      meta = h('span', { className: 'ui-card__meta' }, options.meta);
      side.append(meta);
    }
    append(side, options.actions ?? []);
    root.append(
      h('header', { className: 'ui-card__head' }, h('h2', { className: 'ui-card__title', text: options.title }), side),
    );
  }
  const body = h(
    'div',
    {
      className: cx(
        'ui-card__body',
        options.flush && 'ui-card__body--flush',
        options.scroll && 'ui-card__body--scroll',
      ),
    },
    ...(options.body ?? []),
  );
  root.append(body);
  if (options.foot) root.append(h('footer', { className: 'ui-card__foot' }, ...options.foot));
  return { root, body, meta };
}
