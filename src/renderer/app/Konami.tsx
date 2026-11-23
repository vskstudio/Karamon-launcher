import { useEffect, useState } from 'preact/hooks';
import { PixelIcon } from '../ui';

const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const FLIGHT_MS = 1800;

export function Konami() {
  const [flights, setFlights] = useState(0);

  useEffect(() => {
    let progress = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === SEQUENCE[progress]) {
        progress += 1;
        if (progress === SEQUENCE.length) {
          progress = 0;
          setFlights((count) => count + 1);
        }
      } else {
        progress = key === SEQUENCE[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (flights === 0) return;
    const timer = setTimeout(() => setFlights(0), FLIGHT_MS);
    return () => clearTimeout(timer);
  }, [flights]);

  if (flights === 0) return null;
  return (
    <div class="konami" aria-hidden="true">
      <span key={flights} class="konami__ball">
        <PixelIcon name="pokeball" size={96} />
      </span>
    </div>
  );
}
