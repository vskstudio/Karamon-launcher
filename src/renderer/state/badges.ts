import { signal } from '@preact/signals';
import type { PageId } from './navigation';

export const routeBadges = signal<Partial<Record<PageId, string>>>({});

export function setRouteBadge(page: PageId, value: string | null): void {
  const next = { ...routeBadges.value };
  if (value) next[page] = value;
  else delete next[page];
  routeBadges.value = next;
}
