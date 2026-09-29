import { createElement, Globe, MessagesSquare, type IconNode } from 'lucide';
import type { LauncherApi } from '../../ipc/contract';

export interface QuickLink {
  label: string;
  url: string;
  icon: IconNode;
}

const LINKS: QuickLink[] = [
  { label: 'Site', url: 'https://karamon.fr', icon: Globe },
  { label: 'Discord', url: 'https://discord.gg/karavr', icon: MessagesSquare },
];

export class QuickLinks {
  static render(api: LauncherApi, container: HTMLElement): void {
    container.textContent = '';
    for (const link of LINKS) {
      const btn = document.createElement('button');
      btn.className = 'nav-link';
      btn.title = link.url;
      const icon = createElement(link.icon, { class: 'nav-icon', 'stroke-width': 1.75, 'aria-hidden': 'true' });
      const label = document.createElement('span');
      label.textContent = link.label;
      btn.append(icon, label);
      btn.addEventListener('click', () => {
        void api.openExternal(link.url);
      });
      container.appendChild(btn);
    }
  }
}
