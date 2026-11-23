import type { HttpClient } from '../../shared/HttpClient';
import type { MinecraftProfile } from './MinecraftProfile.ts';
import { savedSkinDataUrl } from './OfflineSkin.ts';

const SESSION_PROFILE_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';
const ELY_TEXTURES_URL = 'https://skinsystem.ely.by/textures/';
const ELY_LOOKUP_TOTAL_TIMEOUT_MS = 8000;
const TEXTURE_URL = /^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i;
const ELY_SKIN_URL = /^https?:\/\/(?:ely\.by\/storage\/skins\/[0-9a-z_-]+\.png|textures\.minecraft\.net\/texture\/[0-9a-f]+)$/i;

interface SessionProfile {
  properties?: { name?: string; value?: string }[];
}

export function skinUrlFromProfile(raw: unknown): string | null {
  const property = (raw as SessionProfile | null)?.properties?.find((p) => p.name === 'textures');
  if (!property?.value) return null;
  try {
    const textures = JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'));
    const url = textures?.textures?.SKIN?.url;
    if (typeof url !== 'string' || !TEXTURE_URL.test(url)) return null;
    return url.replace(/^http:/i, 'https:');
  } catch {
    return null;
  }
}

export function skinUrlFromElyTextures(raw: unknown): string | null {
  const url = (raw as { SKIN?: { url?: unknown } } | null)?.SKIN?.url;
  if (typeof url !== 'string' || !ELY_SKIN_URL.test(url)) return null;
  return url.replace(/^http:/i, 'https:');
}

export class SkinLookup {
  private readonly http: HttpClient;
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(http: HttpClient) {
    this.http = http;
  }

  async skinFor(profile: MinecraftProfile, gameDir: string): Promise<string | null> {
    if (profile.kind === 'microsoft') return await this.skinUrl(profile.id);
    return savedSkinDataUrl(gameDir, profile.name) ?? (await this.elySkinUrl(profile.name));
  }

  skinUrl(profileId: string): Promise<string | null> {
    const id = profileId.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) return Promise.resolve(null);
    return this.cached(id, () => this.http.getJson<unknown>(SESSION_PROFILE_URL + id).then(skinUrlFromProfile));
  }

  elySkinUrl(name: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return Promise.resolve(null);
    return this.cached(`ely:${name.toLowerCase()}`, async () => {
      const res = await this.http.get(ELY_TEXTURES_URL + name, { totalTimeoutMs: ELY_LOOKUP_TOTAL_TIMEOUT_MS });
      if (res.status !== 200) return null;
      return skinUrlFromElyTextures(JSON.parse(res.body.toString('utf8')));
    });
  }

  private cached(key: string, lookup: () => Promise<string | null>): Promise<string | null> {
    let pending = this.cache.get(key);
    if (!pending) {
      pending = lookup().catch(() => {
        this.cache.delete(key);
        return null;
      });
      this.cache.set(key, pending);
    }
    return pending;
  }
}
