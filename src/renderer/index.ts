import { KaramonRenderer } from './KaramonRenderer';
import { $opt } from './util/dom';

const brandLogo = $opt('brand-logo');
if (brandLogo instanceof HTMLImageElement) {
  brandLogo.addEventListener('error', () => {
    brandLogo.style.display = 'none';
  });
}

new KaramonRenderer(window.launcher).start();
