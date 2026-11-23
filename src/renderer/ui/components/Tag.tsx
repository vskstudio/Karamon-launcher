import type { ComponentChildren } from 'preact';
import { cx } from '../cx';
import './Tag.css';

export type Tone = 'neutral' | 'accent' | 'lumis' | 'gold' | 'success' | 'warning' | 'danger';

interface TagProps {
  children: ComponentChildren;
  tone?: Tone;
  dot?: boolean;
  class?: string;
}

export function Tag({ children, tone = 'neutral', dot = false, class: className }: TagProps) {
  return (
    <span class={cx('ui-tag', `ui-tag--${tone}`, className)}>
      {dot ? <StatusDot tone={tone} /> : null}
      {children}
    </span>
  );
}

interface BadgeProps {
  children: ComponentChildren;
  tone?: 'accent' | 'gold' | 'lumis';
  label?: string;
  class?: string;
}

export function Badge({ children, tone = 'accent', label, class: className }: BadgeProps) {
  return (
    <span class={cx('ui-badge', `ui-badge--${tone}`, className)} aria-label={label}>
      {children}
    </span>
  );
}

interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
}

export function StatusDot({ tone = 'success', pulse = false }: StatusDotProps) {
  return <span class={cx('ui-dot', `ui-dot--${tone}`, pulse && 'ui-dot--pulse')} aria-hidden="true" />;
}
