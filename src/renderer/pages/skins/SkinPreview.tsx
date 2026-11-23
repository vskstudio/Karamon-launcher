import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import portal from '../../assets/art/backdrop_portal.webp';
import { Button, IconButton, Spinner } from '../../ui';
import { drawSkin, SKIN_CANVAS_HEIGHT, SKIN_CANVAS_WIDTH, type SkinModel, type SkinView } from './skinRender';

const turnOrder: readonly SkinView[] = ['front', 'right', 'back', 'left'];

const viewLabels: Record<SkinView, string> = {
  front: 'De face',
  right: 'Côté droit',
  back: 'De dos',
  left: 'Côté gauche',
};

interface SkinPreviewProps {
  image: HTMLImageElement | null;
  model: SkinModel;
  loading: boolean;
  emptyText: ComponentChildren;
}

function turned(view: SkinView, step: number): SkinView {
  const index = turnOrder.indexOf(view);
  return turnOrder[(index + step + turnOrder.length) % turnOrder.length] ?? 'front';
}

export function SkinPreview({ image, model, loading, emptyText }: SkinPreviewProps) {
  const [view, setView] = useState<SkinView>('front');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawSkin(canvasRef.current, image, model, view);
  }, [image, model, view]);

  return (
    <div class="skins__stage">
      <img class="skins__stage-art pixelated" src={portal} alt="" />
      <div class="skins__stage-veil" aria-hidden="true" />
      {!image && !loading ? <p class="skins__empty">{emptyText}</p> : null}
      <div class="skins__figure">
        {image ? (
          <canvas
            key={view}
            ref={canvasRef}
            class="skins__canvas"
            width={SKIN_CANVAS_WIDTH}
            height={SKIN_CANVAS_HEIGHT}
            role="img"
            aria-label={`Aperçu du skin, ${viewLabels[view].toLowerCase()}`}
          />
        ) : loading ? (
          <Spinner size={28} label="Chargement du skin" />
        ) : null}
      </div>
      {image ? (
        <div class="skins__controls">
          <span class="skins__view" aria-live="polite">
            {viewLabels[view]}
          </span>
          <div class="skins__turn">
            <IconButton glyph="rotateLeft" label="Tourner à gauche" onClick={() => setView(turned(view, -1))} />
            <Button variant="ghost" onClick={() => setView('front')}>
              Face
            </Button>
            <IconButton glyph="rotateRight" label="Tourner à droite" onClick={() => setView(turned(view, 1))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
