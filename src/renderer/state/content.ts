import { signal } from '@preact/signals';
import type { PackInfo } from '../../ipc/contract';
import { api } from './api';

export const packInfo = signal<PackInfo | null>(null);

export async function loadPackInfo(): Promise<void> {
  packInfo.value = await api.packInfo().catch(() => null);
}
