import type { ComponentChildren, Ref } from 'preact';
import { cx } from '../cx';
import type { PixelIconName } from '../pixelIcons';
import { Glyph, type GlyphName } from './Glyph';
import { PixelIcon } from './PixelIcon';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'lumis' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children?: ComponentChildren;
  variant?: ButtonVariant;
  size?: ButtonSize;
  glyph?: GlyphName;
  pixel?: PixelIconName;
  trailing?: ComponentChildren;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  label?: string;
  describedBy?: string;
  type?: 'button' | 'submit';
  onClick?: (event: MouseEvent) => void;
  buttonRef?: Ref<HTMLButtonElement>;
  class?: string;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  glyph,
  pixel,
  trailing,
  loading = false,
  disabled = false,
  full = false,
  label,
  describedBy,
  type = 'button',
  onClick,
  buttonRef,
  class: className,
}: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      type={type}
      class={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, full && 'ui-button--full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {loading ? <Spinner size={14} /> : glyph ? <Glyph name={glyph} size={size === 'sm' ? 14 : 16} /> : null}
      {!loading && pixel ? <PixelIcon name={pixel} size={size === 'sm' ? 14 : 16} /> : null}
      {children !== undefined ? <span class="ui-button__label">{children}</span> : null}
      {trailing}
    </button>
  );
}

interface IconButtonProps {
  glyph: GlyphName;
  label: string;
  onClick?: (event: MouseEvent) => void;
  tone?: 'default' | 'danger';
  size?: ButtonSize;
  expanded?: boolean;
  controls?: string;
  hasPopup?: 'menu' | 'dialog';
  class?: string;
}

export function IconButton({ glyph, label, onClick, tone = 'default', size = 'md', expanded, controls, hasPopup, class: className }: IconButtonProps) {
  return (
    <button
      type="button"
      class={cx('ui-icon-button', `ui-icon-button--${size}`, tone === 'danger' && 'ui-icon-button--danger', className)}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-haspopup={hasPopup}
      onClick={onClick}
    >
      <Glyph name={glyph} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
