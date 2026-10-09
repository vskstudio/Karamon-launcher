import crypto from 'crypto';

const NAME_LOOKUP_URL = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/';
const NAME_LOOKUP_TIMEOUT_MS = 4000;

/** Placeholder token for an offline session: Minecraft needs one, nobody checks it. */
export const OFFLINE_ACCESS_TOKEN = '0';

/**
 * The UUID Minecraft gives a player without a licence, dashed:
 * `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))`, an MD5 name UUID (version 3, IETF variant).
 */
export function offlineUuid(name: string): string {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `taken`: a Mojang account has this name; `unknown`: Mojang did not answer clearly. */
export type NameStatus = 'free' | 'taken' | 'unknown';

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number }>;

/** Asks Mojang whether the name belongs to a Minecraft account. Never throws. */
export async function mojangNameStatus(name: string, fetchImpl: Fetch = fetch): Promise<NameStatus> {
  try {
    const res = await fetchImpl(NAME_LOOKUP_URL + encodeURIComponent(name), {
      signal: AbortSignal.timeout(NAME_LOOKUP_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (res.status === 200) return 'taken';
    if (res.status === 404 || res.status === 204) return 'free';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
