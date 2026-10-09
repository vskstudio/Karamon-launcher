import {
  Camera,
  Check,
  createIcons,
  Folder,
  FolderOpen,
  Gauge,
  Hammer,
  House,
  Minus,
  Package,
  Play,
  RefreshCw,
  ScrollText,
  Settings,
  ShoppingBag,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide';

/** Swaps every `<i data-lucide="name">` in the page for its Lucide SVG. */
export function renderIcons(): void {
  createIcons({
    icons: {
      Camera,
      Check,
      Folder,
      FolderOpen,
      Gauge,
      Hammer,
      House,
      Minus,
      Package,
      Play,
      RefreshCw,
      ScrollText,
      Settings,
      ShoppingBag,
      Square,
      Terminal,
      Wrench,
      X,
    },
    attrs: { 'stroke-width': 1.75, 'aria-hidden': 'true' },
  });
}
