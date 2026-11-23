import { signal } from '@preact/signals';
import type { AuthSessionResult, MinecraftProfile } from '../../ipc/contract';
import { toast } from '../ui';
import { api } from './api';
import { log } from './console';

export const activeAccount = signal<MinecraftProfile | null>(null);
export const accounts = signal<MinecraftProfile[]>([]);
export const accountsDialogOpen = signal(false);

export function applySession(session: AuthSessionResult, message?: string): void {
  activeAccount.value = session.active;
  accounts.value = session.accounts;
  if (message) {
    toast(message);
    log(message, 'success');
  }
}

export async function refreshSession(): Promise<void> {
  applySession(await api.authGetSession());
}

export async function switchAccount(profile: MinecraftProfile): Promise<void> {
  applySession(await api.authSwitch(profile.id), `Tu joues maintenant avec ${profile.name}.`);
}

export async function logout(): Promise<void> {
  applySession(await api.authLogout(), 'Déconnecté.');
}

export function openAccounts(): void {
  accountsDialogOpen.value = true;
}
