import type { ActiveSession } from '../auth/AuthSession';
import type { ArgumentVars } from './ArgumentResolver';

export type LaunchIdentity = Pick<
  ArgumentVars,
  'authPlayerName' | 'authUuid' | 'authAccessToken' | 'authXuid' | 'clientId' | 'userType'
>;

/**
 * Who the game plays as: --username, --uuid (dashed), --accessToken and --userType. A Microsoft account passes its
 * Minecraft token and `msa`; an offline account passes its offline UUID, a placeholder token and `legacy`, so the game
 * never calls Mojang with it (no profile keys, no session join: the Karamon server skips that check for it).
 */
export function launchIdentity(session: Pick<ActiveSession, 'profile' | 'accessToken' | 'userType'>): LaunchIdentity {
  return {
    authPlayerName: session.profile.name,
    authUuid: dashedUuid(session.profile.id),
    authAccessToken: session.accessToken,
    authXuid: '',
    clientId: '',
    userType: session.userType,
  };
}

export function dashedUuid(raw: string): string {
  if (raw.includes('-')) return raw;
  if (raw.length !== 32) return raw;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}
