import { useState } from 'preact/hooks';

interface OfferArtProps {
  src: string;
  fallback: string;
  class?: string;
}

export function OfferArt({ src, fallback, class: className }: OfferArtProps) {
  const [failed, setFailed] = useState(false);
  const resolved = src && !failed ? src : fallback;
  return <img class={className} src={resolved} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}
