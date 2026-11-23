import crypto from 'crypto';
import { isValidOfflineName } from '../../../shared/OfflineName.ts';
import type { HttpClient } from '../../shared/HttpClient.ts';

const NAME_LOOKUP_URL = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/';
const NAME_LOOKUP_TIMEOUT_MS = 4000;

export const OFFLINE_ACCESS_TOKEN = '0';

export function offlineUuid(name: string): string {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type NameStatus = 'free' | 'taken' | 'unknown';

export async function mojangNameStatus(name: string, http: Pick<HttpClient, 'get'>): Promise<NameStatus> {
  try {
    const res = await http.get(NAME_LOOKUP_URL + encodeURIComponent(name), {
      totalTimeoutMs: NAME_LOOKUP_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 200) return 'taken';
    if (res.status === 404 || res.status === 204) return 'free';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function offlineNameStatus(name: string, http: Pick<HttpClient, 'get'>): Promise<NameStatus> {
  return isValidOfflineName(name) ? await mojangNameStatus(name, http) : 'unknown';
}
