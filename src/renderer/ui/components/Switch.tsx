import { cx } from '../cx';
import './Controls.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, describedBy, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      class={cx('ui-switch', checked && 'is-on')}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="ui-switch__thumb" />
    </button>
  );
}
