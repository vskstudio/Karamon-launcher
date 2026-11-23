import { signal } from '@preact/signals';

export type PageId = 'home' | 'wiki' | 'shop' | 'account' | 'skins' | 'captures' | 'pack' | 'tools' | 'settings';

export interface Location {
  page: PageId;
  param: string | null;
}

export const location = signal<Location>({ page: 'home', param: null });

export function navigate(page: PageId, param: string | null = null): void {
  location.value = { page, param };
}
