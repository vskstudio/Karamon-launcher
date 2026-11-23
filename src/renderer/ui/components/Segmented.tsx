import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { cx } from '../cx';
import type { PixelIconName } from '../pixelIcons';
import { PixelIcon } from './PixelIcon';
import './Segmented.css';

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  pixel?: PixelIconName;
  badge?: ComponentChildren;
  controls?: string;
}

interface SegmentedProps<T extends string> {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  role?: 'tablist' | 'radiogroup';
  size?: 'sm' | 'md';
  class?: string;
}

export function Segmented<T extends string>({ items, value, onChange, label, role = 'radiogroup', size = 'md', class: className }: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRole = role === 'tablist' ? 'tab' : 'radio';

  const moveFocus = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (step === 0 && edge === null) return;
    event.preventDefault();
    const next = edge ?? (index + step + items.length) % items.length;
    const target = items[next];
    if (!target) return;
    onChange(target.value);
    listRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <div ref={listRef} class={cx('ui-segmented', 'surface', 'surface--inset', `ui-segmented--${size}`, className)} role={role} aria-label={label}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role={itemRole}
            class={cx('ui-segmented__item', selected && 'is-selected')}
            aria-selected={role === 'tablist' ? selected : undefined}
            aria-checked={role === 'radiogroup' ? selected : undefined}
            aria-controls={item.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {item.pixel ? <PixelIcon name={item.pixel} size={16} /> : null}
            <span>{item.label}</span>
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
