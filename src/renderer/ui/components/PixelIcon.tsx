import { cx } from '../cx';
import { pixelIcons, type PixelIconName } from '../pixelIcons';

interface PixelIconProps {
  name: PixelIconName;
  size?: number;
  label?: string;
  class?: string;
}

export function PixelIcon({ name, size = 20, label, class: className }: PixelIconProps) {
  return (
    <img
      class={cx('pixelated', className)}
      src={pixelIcons[name]}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : 'true'}
      draggable={false}
    />
  );
}
