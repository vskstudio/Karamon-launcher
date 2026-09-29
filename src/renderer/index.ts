import { KaramonRenderer } from './KaramonRenderer';
import { $opt } from './util/dom';
import { renderIcons } from './util/icons';

const brandLogo = $opt('brand-logo');
if (brandLogo instanceof HTMLImageElement) {
  brandLogo.addEventListener('error', () => {
    brandLogo.style.display = 'none';
  });
}

renderIcons();
new KaramonRenderer(window.launcher).start();
