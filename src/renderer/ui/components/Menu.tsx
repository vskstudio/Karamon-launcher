import type { ComponentChildren, RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../cx';
import { useOverlayLayer } from '../overlayStack';
import type { GlyphName } from './Glyph';
import { Glyph } from './Glyph';
import './Menu.css';

interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  id?: string;
  width?: number;
  children: ComponentChildren;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 6;
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

export function Menu({ open, onClose, anchorRef, label, id, width = 300, children }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  useOverlayLayer(open, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setPosition({ top: rect.bottom + GAP, left });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, position !== null]);

  if (!open || !position) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      class="ui-menu surface"
      role="menu"
      aria-label={label}
      style={{ top: `${position.top}px`, left: `${position.left}px`, width: `${width}px` }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

interface MenuItemProps {
  children: ComponentChildren;
  onSelect: () => void;
  leading?: ComponentChildren;
  glyph?: GlyphName;
  trailing?: ComponentChildren;
  tone?: 'default' | 'danger';
  checked?: boolean;
}

export function MenuItem({ children, onSelect, leading, glyph, trailing, tone = 'default', checked }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      class={cx('ui-menu__item', tone === 'danger' && 'ui-menu__item--danger')}
      onClick={onSelect}
    >
      <span class="ui-menu__leading">{leading ?? (glyph ? <Glyph name={glyph} size={16} /> : null)}</span>
      <span class="ui-menu__text">{children}</span>
      {trailing}
      {checked ? <Glyph name="check" size={16} class="ui-menu__check" /> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div class="ui-menu__separator" role="separator" />;
}
