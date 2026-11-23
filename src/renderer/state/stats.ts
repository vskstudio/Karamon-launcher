import { signal } from '@preact/signals';
import type { PlayStats } from '../../ipc/contract';
import { api } from './api';

export const stats = signal<PlayStats | null>(null);

export async function refreshStats(): Promise<void> {
  stats.value = await api.getStats();
}

export async function resetStats(): Promise<void> {
  stats.value = await api.resetStats();
}
