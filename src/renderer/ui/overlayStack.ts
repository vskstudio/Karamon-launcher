import { useEffect, useRef } from 'preact/hooks';

type CloseHandler = () => void;

interface Layer {
  token: symbol;
  close: CloseHandler | null;
}

const layers: Layer[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = layers[layers.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.close?.();
}

document.addEventListener('keydown', onKeyDown, true);

export function isTopLayer(token: symbol): boolean {
  return layers[layers.length - 1]?.token === token;
}

export function useOverlayLayer(open: boolean, close: CloseHandler | null): symbol {
  const tokenRef = useRef(Symbol('overlay'));
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const layer: Layer = { token: tokenRef.current, close: () => closeRef.current?.() };
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    };
  }, [open]);

  return tokenRef.current;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(open: boolean, token: symbol) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const first = container?.querySelector<HTMLElement>('[data-autofocus]') ?? container?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !container || !isTopLayer(token)) return;
      const focusables = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const head = focusables[0];
      const tail = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return containerRef;
}
