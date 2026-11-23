import type { ComponentChildren } from 'preact';
import { cx } from '../cx';
import { Glyph } from './Glyph';
import './Controls.css';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ComponentChildren;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, children, disabled = false }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      class={cx('ui-checkbox', checked && 'is-on')}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="ui-checkbox__box" aria-hidden="true">
        {checked ? <Glyph name="check" size={12} strokeWidth={3} /> : null}
      </span>
      <span class="ui-checkbox__label">{children}</span>
    </button>
  );
}
