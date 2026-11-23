import type { ComponentChildren } from 'preact';
import { cx } from '../cx';
import type { PixelIconName } from '../pixelIcons';
import { PixelIcon } from './PixelIcon';
import './Banner.css';

interface BannerProps {
  pixel: PixelIconName;
  children: ComponentChildren;
  actions?: ComponentChildren;
  tone?: 'accent' | 'lumis' | 'warning';
}

export function Banner({ pixel, children, actions, tone = 'accent' }: BannerProps) {
  return (
    <div class={cx('ui-banner', `ui-banner--${tone}`)} role="status">
      <PixelIcon name={pixel} size={22} />
      <div class="ui-banner__text">{children}</div>
      {actions ? <div class="ui-banner__actions">{actions}</div> : null}
    </div>
  );
}
