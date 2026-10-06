import { h } from './h';

export interface Stat {
  root: HTMLDivElement;
  value: HTMLSpanElement;
}

export function stat(label: string, value = '…'): Stat {
  const valueEl = h('span', { className: 'ui-stat__value', text: value });
  return { root: h('div', { className: 'ui-stat' }, h('span', { className: 'ui-stat__label', text: label }), valueEl), value: valueEl };
}

export function stats(...items: Stat[]): HTMLDivElement {
  return h('div', { className: 'ui-stats' }, ...items.map((item) => item.root));
}

export function keyValue(key: string, value: string): { root: HTMLDivElement; value: HTMLSpanElement } {
  const valueEl = h('span', { className: 'ui-kv__value', text: value });
  return { root: h('div', { className: 'ui-kv' }, h('span', { className: 'ui-kv__key', text: key }), valueEl), value: valueEl };
}
