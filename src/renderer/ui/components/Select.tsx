import { useId, useRef, useState } from 'preact/hooks';
import { cx } from '../cx';
import { Glyph } from './Glyph';
import { Menu, MenuItem } from './Menu';
import './Select.css';

export interface SelectItem<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  items: readonly SelectItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  describedBy?: string;
  placeholder?: string;
  menuWidth?: number;
  class?: string;
}

export function Select<T extends string>({ items, value, onChange, label, describedBy, placeholder = '…', menuWidth = 320, class: className }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const labelId = useId();
  const current = items.find((item) => item.value === value);

  return (
    <>
      <span id={labelId} class="visually-hidden">
        {label}
      </span>
      <button
        ref={anchorRef}
        type="button"
        class={cx('ui-select', 'surface', 'surface--inset', className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={`${labelId} ${menuId}-value`}
        aria-describedby={describedBy}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span id={`${menuId}-value`} class="ui-select__value">
          {current?.label ?? placeholder}
        </span>
        <Glyph name="chevronDown" size={14} class="ui-select__chevron" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} label={label} id={menuId} width={menuWidth}>
        {items.map((item) => (
          <MenuItem
            key={item.value}
            trailing={item.value === value ? <Glyph name="check" size={16} class="ui-select__check" /> : null}
            onSelect={() => {
              setOpen(false);
              if (item.value !== value) onChange(item.value);
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
