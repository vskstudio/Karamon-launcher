import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from '../cx';
import './Panel.css';

export type PanelVariant = 'card' | 'accent' | 'lumis' | 'inset' | 'glass';
export type PanelPadding = 'none' | 'sm' | 'md' | 'lg';

interface PanelProps {
  children?: ComponentChildren;
  variant?: PanelVariant;
  padding?: PanelPadding;
  title?: ComponentChildren;
  actions?: ComponentChildren;
  as?: 'section' | 'div' | 'article' | 'aside';
  class?: string;
}

export function Panel({ children, variant = 'card', padding = 'md', title, actions, as = 'section', class: className }: PanelProps) {
  const titleId = useId();
  const Tag = as;
  return (
    <Tag
      class={cx('ui-panel', 'surface', variant !== 'card' && `surface--${variant}`, `ui-panel--pad-${padding}`, className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {title || actions ? (
        <header class="ui-panel__head">
          {title ? (
            <h2 id={titleId} class="ui-panel__title">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div class="ui-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

interface PanelButtonProps {
  children?: ComponentChildren;
  onClick: () => void;
  label?: string;
  describedBy?: string;
  selected?: boolean;
  highlighted?: boolean;
  padding?: PanelPadding;
  class?: string;
}

export function PanelButton({ children, onClick, label, describedBy, selected = false, highlighted = false, padding = 'md', class: className }: PanelButtonProps) {
  return (
    <button
      type="button"
      class={cx(
        'ui-panel',
        'ui-panel--button',
        'surface',
        (highlighted || selected) && 'surface--accent',
        `ui-panel--pad-${padding}`,
        selected && 'is-selected',
        className,
      )}
      aria-label={label}
      aria-describedby={describedBy}
      aria-pressed={selected || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
