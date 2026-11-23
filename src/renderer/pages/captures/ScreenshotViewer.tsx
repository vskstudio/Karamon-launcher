import { createPortal } from 'preact/compat';
import { useEffect, useId, useState } from 'preact/hooks';
import type { ScreenshotEntry } from '../../../ipc/contract';
import { Button, IconButton } from '../../ui';
import { isTopLayer, useFocusTrap, useOverlayLayer } from '../../ui/overlayStack';
import { formatDayTime, formatSize } from '../../util/format';

interface ScreenshotViewerProps {
  entries: readonly ScreenshotEntry[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onCopy: (entry: ScreenshotEntry) => void;
  onDelete: (entry: ScreenshotEntry) => void;
}

export function ScreenshotViewer({ entries, index, onIndexChange, onClose, onCopy, onDelete }: ScreenshotViewerProps) {
  const entry = index === null ? undefined : entries[index];
  const open = entry !== undefined;
  const token = useOverlayLayer(open, onClose);
  const containerRef = useFocusTrap(open, token);
  const titleId = useId();
  const [resolution, setResolution] = useState<string | null>(null);

  useEffect(() => {
    setResolution(null);
  }, [entry?.url]);

  useEffect(() => {
    if (!open || index === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopLayer(token)) return;
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onIndexChange(index - 1);
      } else if (event.key === 'ArrowRight' && index < entries.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, index, entries.length]);

  if (!entry || index === null) return null;

  return createPortal(
    <div
      class="shot-viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={containerRef} class="shot-viewer__frame" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header class="shot-viewer__head">
          <div class="shot-viewer__caption">
            <h2 id={titleId} class="shot-viewer__title num">
              {formatDayTime(entry.mtime)}
            </h2>
            <p class="shot-viewer__meta">
              <span class="mono">{entry.name}</span>
              <span class="num">{formatSize(entry.size)}</span>
              {resolution ? <span class="num">{resolution}</span> : null}
              <span class="num">
                {index + 1} sur {entries.length}
              </span>
            </p>
          </div>
          <div class="shot-viewer__actions">
            <Button size="sm" glyph="copy" onClick={() => onCopy(entry)}>
              Copier
            </Button>
            <Button size="sm" glyph="trash" variant="danger" onClick={() => onDelete(entry)}>
              Supprimer
            </Button>
            <IconButton glyph="close" label="Fermer" size="sm" onClick={onClose} />
          </div>
        </header>
        <div class="shot-viewer__stage">
          <img
            class="shot-viewer__image"
            src={entry.url}
            alt={`Capture du ${formatDayTime(entry.mtime)}`}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget as HTMLImageElement;
              if (image.naturalWidth > 0) setResolution(`${image.naturalWidth} × ${image.naturalHeight}`);
            }}
          />
          {index > 0 ? (
            <IconButton glyph="chevronLeft" label="Capture précédente" class="shot-viewer__nav shot-viewer__nav--prev" onClick={() => onIndexChange(index - 1)} />
          ) : null}
          {index < entries.length - 1 ? (
            <IconButton glyph="chevronRight" label="Capture suivante" class="shot-viewer__nav shot-viewer__nav--next" onClick={() => onIndexChange(index + 1)} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
