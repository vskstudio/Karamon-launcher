import { h, type Child } from './h';

export interface ToggleOptions {
  id?: string;
  checked?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
}

export function toggle(options: ToggleOptions): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = h('input', {
    id: options.id,
    attrs: { type: 'checkbox', role: 'switch', 'aria-label': options.label },
  });
  input.checked = options.checked ?? false;
  if (options.onChange) input.addEventListener('change', () => options.onChange?.(input.checked));
  const root = h('label', { className: 'ui-toggle' }, input, h('span', { className: 'ui-toggle__track' }));
  return { root, input };
}

export interface SettingRowOptions {
  label: string;
  hint?: Child;
  control: Child;
}

export function settingRow(options: SettingRowOptions): HTMLDivElement {
  return h(
    'div',
    { className: 'ui-setting' },
    h(
      'div',
      { className: 'ui-setting__text' },
      h('span', { className: 'ui-setting__label', text: options.label }),
      options.hint !== undefined ? h('span', { className: 'ui-setting__hint' }, options.hint) : null,
    ),
    options.control,
  );
}
