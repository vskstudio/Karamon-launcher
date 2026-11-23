import { useState } from 'preact/hooks';
import { cx } from '../cx';
import { Glyph } from './Glyph';
import './SkinFace.css';

interface SkinFaceProps {
  skinUrl: string | null | undefined;
  fallbackUrl?: string | null;
  size?: number;
  ring?: boolean;
  class?: string;
}

export function SkinFace({ skinUrl, fallbackUrl, size = 24, ring = false, class: className }: SkinFaceProps) {
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const style = { '--face': `${size}px` } as Record<string, string>;

  if (skinUrl) {
    const layer = `url("${skinUrl}")`;
    return (
      <span
        class={cx('ui-skin-face', ring && 'ui-skin-face--ring', className)}
        style={{ ...style, backgroundImage: `${layer}, ${layer}` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span class={cx('ui-skin-face', 'ui-skin-face--empty', ring && 'ui-skin-face--ring', className)} style={style} aria-hidden="true">
      {fallbackUrl && !fallbackFailed ? (
        <img src={fallbackUrl} alt="" width={size} height={size} onError={() => setFallbackFailed(true)} />
      ) : (
        <Glyph name="user" size={Math.round(size * 0.6)} />
      )}
    </span>
  );
}
