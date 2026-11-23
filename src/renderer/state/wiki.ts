import { computed, signal } from '@preact/signals';
import type { WikiGroup, WikiPage, WikiPageRef } from '../../ipc/contract';
import { api } from './api';
import type { Loadable } from './loadable';

export type WikiPageState = { status: 'loading' } | { status: 'ready'; page: WikiPage } | { status: 'missing' } | { status: 'error' };

export interface WikiEntry extends WikiPageRef {
  group: string;
}

export const wikiIndex = signal<Loadable<WikiGroup[]>>({ status: 'idle' });
export const wikiPages = signal<Readonly<Record<string, WikiPageState>>>({});

export const wikiEntries = computed<WikiEntry[]>(() => {
  const index = wikiIndex.value;
  if (index.status !== 'ready') return [];
  return index.data.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.name })));
});

export async function loadWikiIndex(force = false): Promise<void> {
  const current = wikiIndex.value.status;
  if (current === 'loading' || (!force && current === 'ready')) return;
  wikiIndex.value = { status: 'loading' };
  try {
    wikiIndex.value = { status: 'ready', data: await api.wikiIndex() };
  } catch {
    wikiIndex.value = { status: 'error' };
  }
}

function setPageState(slug: string, state: WikiPageState): void {
  wikiPages.value = { ...wikiPages.value, [slug]: state };
}

export async function loadWikiPage(slug: string, force = false): Promise<void> {
  const current = wikiPages.value[slug]?.status;
  if (current === 'loading' || (!force && (current === 'ready' || current === 'missing'))) return;
  setPageState(slug, { status: 'loading' });
  try {
    const page = await api.wikiPage(slug);
    setPageState(slug, page ? { status: 'ready', page } : { status: 'missing' });
  } catch {
    setPageState(slug, { status: 'error' });
  }
}
