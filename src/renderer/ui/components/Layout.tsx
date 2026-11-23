import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from '../cx';
import type { PixelIconName } from '../pixelIcons';
import { PixelIcon } from './PixelIcon';
import './Layout.css';

interface PageProps {
  children: ComponentChildren;
  label: string;
  scroll?: boolean;
  padded?: boolean;
  class?: string;
}

export function Page({ children, label, scroll = true, padded = true, class: className }: PageProps) {
  return (
    <section class={cx('ui-page', 'enter', scroll && 'ui-page--scroll', padded && 'ui-page--padded', className)} aria-label={label}>
      {children}
    </section>
  );
}

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ComponentChildren;
  actions?: ComponentChildren;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header class="ui-page-header">
      <div class="ui-page-header__text">
        {eyebrow ? <p class="ui-eyebrow">{eyebrow}</p> : null}
        <h1 class="ui-page-header__title">{title}</h1>
        {description ? <p class="ui-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div class="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

interface SectionTitleProps {
  children: ComponentChildren;
  actions?: ComponentChildren;
}

export function SectionTitle({ children, actions }: SectionTitleProps) {
  return (
    <div class="ui-section-title">
      <h2 class="ui-eyebrow">{children}</h2>
      {actions}
    </div>
  );
}

interface SettingRowProps {
  title: string;
  description?: ComponentChildren;
  control: (ids: { labelId: string; descriptionId: string }) => ComponentChildren;
}

export function SettingRow({ title, description, control }: SettingRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div class="ui-setting">
      <div class="ui-setting__text">
        <div id={labelId} class="ui-setting__title">
          {title}
        </div>
        {description ? (
          <div id={descriptionId} class="ui-setting__description">
            {description}
          </div>
        ) : null}
      </div>
      <div class="ui-setting__control">{control({ labelId, descriptionId })}</div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: ComponentChildren;
  hint?: ComponentChildren;
  tone?: 'default' | 'success' | 'warning' | 'lumis';
}

export function Stat({ label, value, hint, tone = 'default' }: StatProps) {
  return (
    <div class="ui-stat">
      <div class="ui-eyebrow">{label}</div>
      <div class="ui-stat__value num">{value}</div>
      {hint ? <div class={cx('ui-stat__hint', `ui-stat__hint--${tone}`)}>{hint}</div> : null}
    </div>
  );
}

interface EmptyStateProps {
  pixel: PixelIconName;
  title: string;
  children?: ComponentChildren;
  actions?: ComponentChildren;
}

export function EmptyState({ pixel, title, children, actions }: EmptyStateProps) {
  return (
    <div class="ui-empty">
      <PixelIcon name={pixel} size={40} />
      <div class="ui-empty__title">{title}</div>
      {children ? <div class="ui-empty__text">{children}</div> : null}
      {actions ? <div class="ui-empty__actions">{actions}</div> : null}
    </div>
  );
}
