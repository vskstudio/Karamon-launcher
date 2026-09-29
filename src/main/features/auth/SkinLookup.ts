import type { HttpClient } from '../../shared/HttpClient';

const SESSION_PROFILE_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';
const TEXTURE_URL = /^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i;

interface SessionProfile {
  properties?: { name?: string; value?: string }[];
}

/** The HTTPS skin URL inside a Mojang session profile, or null when the player has none. */
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

export class SkinLookup {
  private readonly http: HttpClient;
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(http: HttpClient) {
    this.http = http;
  }

  skinUrl(profileId: string): Promise<string | null> {
    const id = profileId.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) return Promise.resolve(null);
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.http
        .getJson<unknown>(SESSION_PROFILE_URL + id)
        .then(skinUrlFromProfile)
        .catch(() => {
          this.cache.delete(id);
          return null;
        });
      this.cache.set(id, pending);
    }
    return pending;
  }
}
