import { signal } from '@preact/signals';
import type { AccountKind, MinecraftProfile } from '../../ipc/contract';
import { toast } from '../ui';
import { api } from './api';
import { log } from './console';
import { accountsDialogOpen, applySession } from './session';

export type AccountsDialogView = 'list' | 'offline';

export const accountsDialogView = signal<AccountsDialogView>('list');
export const logoutRequest = signal<MinecraftProfile | null>(null);

export function accountKindLabel(kind: AccountKind): string {
  return kind === 'offline' ? 'Compte sans licence' : 'Compte Microsoft';
}

export function openAccountsDialog(view: AccountsDialogView = 'list'): void {
  accountsDialogView.value = view;
  accountsDialogOpen.value = true;
}

export function closeAccountsDialog(): void {
  accountsDialogOpen.value = false;
  accountsDialogView.value = 'list';
}

export async function selectAccount(profile: MinecraftProfile): Promise<void> {
  try {
    applySession(await api.authSwitch(profile.id), `Tu joues maintenant avec ${profile.name}.`);
  } catch (error) {
    applySession(await api.authGetSession());
    const message = error instanceof Error ? error.message : String(error);
    log(message, 'error');
    toast(message, 'error');
  }
}

export function requestLogout(profile: MinecraftProfile): void {
  logoutRequest.value = profile;
}

export async function confirmLogout(): Promise<void> {
  logoutRequest.value = null;
  applySession(await api.authLogout(), 'Déconnecté.');
}
