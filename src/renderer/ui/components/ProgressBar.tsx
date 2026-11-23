import { cx } from '../cx';
import './ProgressBar.css';

interface ProgressBarProps {
  value: number;
  label: string;
  tone?: 'accent' | 'success';
  class?: string;
}

export function ProgressBar({ value, label, tone = 'accent', class: className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      class={cx('ui-progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div class={cx('ui-progress__fill', tone === 'success' && 'ui-progress__fill--success')} style={{ width: `${clamped}%` }} />
    </div>
  );
}
