import { useEffect, useState } from 'preact/hooks';
import { loadSkinImage } from './skinRender';

interface SkinImageState {
  image: HTMLImageElement | null;
  loading: boolean;
}

export function useSkinImage(url: string | null | undefined): SkinImageState {
  const [state, setState] = useState<SkinImageState>({ image: null, loading: url !== null });

  useEffect(() => {
    if (url === undefined) {
      setState({ image: null, loading: true });
      return;
    }
    if (url === null) {
      setState({ image: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ image: previous.image, loading: true }));
    loadSkinImage(url)
      .then((image) => {
        if (!cancelled) setState({ image, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ image: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
