import { h } from './h';
import type { SelectOption } from './Field';

export interface SegmentedOptions {
  label: string;
  items: SelectOption[];
  value: string;
  onChange?: (value: string) => void;
}

export interface Segmented {
  root: HTMLDivElement;
  value(): string;
  set(value: string): void;
}

export function segmented(options: SegmentedOptions): Segmented {
  let current = options.value;
  const buttons = options.items.map((item) =>
    h('button', {
      className: 'ui-seg__opt',
      text: item.label,
      attrs: { type: 'button', role: 'radio', 'data-value': item.value },
    }),
  );
  const root = h('div', { className: 'ui-seg', attrs: { role: 'radiogroup', 'aria-label': options.label } }, ...buttons);
  const set = (value: string): void => {
    current = value;
    for (const btn of buttons) {
      const on = btn.dataset.value === value;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  };
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value ?? '';
      if (value === current) return;
      set(value);
      options.onChange?.(value);
    });
  }
  set(current);
  return { root, value: () => current, set };
}
