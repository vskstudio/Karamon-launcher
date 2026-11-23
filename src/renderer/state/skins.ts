import { signal } from '@preact/signals';
import type { MinecraftProfile } from '../../ipc/contract';
import { api } from './api';

const skinUrls = signal<ReadonlyMap<string, string | null>>(new Map());
const pending = new Set<string>();

export function skinUrlOf(profile: MinecraftProfile | null): string | null | undefined {
  if (!profile) return null;
  const known = skinUrls.value.get(profile.id);
  if (known !== undefined || pending.has(profile.id)) return known;
  pending.add(profile.id);
  void api
    .skinUrl(profile)
    .catch(() => null)
    .then((url) => {
      pending.delete(profile.id);
      const next = new Map(skinUrls.value);
      next.set(profile.id, url ?? null);
      skinUrls.value = next;
    });
  return undefined;
}

export function forgetSkin(profileId: string): void {
  const next = new Map(skinUrls.value);
  next.delete(profileId);
  skinUrls.value = next;
}

export function avatarFallbackOf(profile: MinecraftProfile | null): string | null {
  if (!profile || profile.kind === 'offline') return null;
  return `https://crafatar.com/avatars/${encodeURIComponent(profile.id)}?size=64&overlay`;
}
