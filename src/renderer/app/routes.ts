import type { ComponentType } from 'preact';
import { AccountPage } from '../pages/account/AccountPage';
import { CapturesPage } from '../pages/captures/CapturesPage';
import { HomePage } from '../pages/home/HomePage';
import { PackPage } from '../pages/pack/PackPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { ShopPage } from '../pages/shop/ShopPage';
import { SkinsPage } from '../pages/skins/SkinsPage';
import { ToolsPage } from '../pages/tools/ToolsPage';
import { WikiPage } from '../pages/wiki/WikiPage';
import type { PageId } from '../state/navigation';
import type { PixelIconName } from '../ui';

export type RouteSection = 'play' | 'me' | 'install';

export interface Route {
  id: PageId;
  label: string;
  pixel: PixelIconName;
  section: RouteSection;
  component: ComponentType<{ param: string | null }>;
}

export const sections: readonly { id: RouteSection; label: string }[] = [
  { id: 'play', label: 'Jouer' },
  { id: 'me', label: 'Moi' },
  { id: 'install', label: 'Installation' },
];

export const routes: readonly Route[] = [
  { id: 'home', label: 'Accueil', pixel: 'emblem', section: 'play', component: HomePage },
  { id: 'wiki', label: 'Wiki', pixel: 'spellbook', section: 'play', component: WikiPage },
  { id: 'shop', label: 'Boutique', pixel: 'shop', section: 'me', component: ShopPage },
  { id: 'account', label: 'Compte', pixel: 'profile', section: 'me', component: AccountPage },
  { id: 'skins', label: 'Skins', pixel: 'players', section: 'me', component: SkinsPage },
  { id: 'captures', label: 'Captures', pixel: 'compass', section: 'me', component: CapturesPage },
  { id: 'pack', label: 'Modpack', pixel: 'chest', section: 'install', component: PackPage },
  { id: 'tools', label: 'Outils', pixel: 'key', section: 'install', component: ToolsPage },
  { id: 'settings', label: 'Réglages', pixel: 'gear', section: 'install', component: SettingsPage },
];

export function routeOf(id: PageId): Route {
  return routes.find((route) => route.id === id) ?? (routes[0] as Route);
}
