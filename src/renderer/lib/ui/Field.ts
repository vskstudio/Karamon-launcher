import { h, cx, type Child } from './h';
import { icon } from './Icon';
import { Search } from 'lucide';

export interface FieldOptions {
  label: string;
  control: Child;
  hint?: Child;
  htmlFor?: string;
}

export interface Field {
  root: HTMLDivElement;
  hint: HTMLSpanElement;
}

export function field(options: FieldOptions): Field {
  const hint = h('span', { className: 'ui-field__hint' }, options.hint);
  hint.hidden = options.hint === undefined;
  const root = h(
    'div',
    { className: 'ui-field' },
    h('label', {
      className: 'ui-field__label',
      text: options.label,
      attrs: options.htmlFor ? { for: options.htmlFor } : {},
    }),
    options.control,
    hint,
  );
  return { root, hint };
}

export function fieldRow(...children: Child[]): HTMLDivElement {
  return h('div', { className: 'ui-field__row' }, ...children);
}

export interface InputOptions {
  id?: string;
  value?: string;
  placeholder?: string;
  mono?: boolean;
  size?: 'sm' | 'md';
  type?: 'text' | 'number' | 'search';
  onInput?: (value: string) => void;
}

export function textInput(options: InputOptions = {}): HTMLInputElement {
  const input = h('input', {
    className: cx('ui-input', options.mono && 'ui-input--mono', options.size === 'sm' && 'ui-input--sm'),
    id: options.id,
    attrs: {
      type: options.type ?? 'text',
      spellcheck: 'false',
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    },
  });
  if (options.value !== undefined) input.value = options.value;
  if (options.onInput) input.addEventListener('input', () => options.onInput?.(input.value));
  return input;
}

export function searchInput(options: InputOptions = {}): { root: HTMLDivElement; input: HTMLInputElement } {
  const input = textInput({ ...options, type: 'search' });
  input.setAttribute('aria-label', options.placeholder ?? 'Rechercher');
  return { root: h('div', { className: 'ui-search' }, icon(Search, 14), input), input };
}

export interface SelectOption {
  value: string;
  label: string;
}

export function selectInput(options: { id?: string; items?: SelectOption[]; onChange?: (value: string) => void }): HTMLSelectElement {
  const select = h('select', { className: 'ui-select', id: options.id });
  setSelectOptions(select, options.items ?? []);
  if (options.onChange) select.addEventListener('change', () => options.onChange?.(select.value));
  return select;
}

export function setSelectOptions(select: HTMLSelectElement, items: SelectOption[]): void {
  select.replaceChildren(...items.map((item) => {
    const opt = h('option', { text: item.label });
    opt.value = item.value;
    return opt;
  }));
}

export interface RangeOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  label: string;
  onInput?: (value: number) => void;
}

export function rangeInput(options: RangeOptions): HTMLInputElement {
  const input = h('input', {
    className: 'ui-range',
    attrs: {
      type: 'range',
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
      'aria-label': options.label,
    },
  });
  input.value = String(options.value);
  syncRangeFill(input);
  input.addEventListener('input', () => {
    syncRangeFill(input);
    options.onInput?.(Number(input.value));
  });
  return input;
}

export function syncRangeFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const ratio = max > min ? (Number(input.value) - min) / (max - min) : 0;
  input.style.setProperty('--fill', `${Math.min(100, Math.max(0, ratio * 100))}%`);
}
