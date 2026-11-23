import type { ActiveSession } from '../auth/AuthSession.ts';
import type { ArgumentVars } from './ArgumentResolver.ts';

export type LaunchIdentity = Pick<
  ArgumentVars,
  'authPlayerName' | 'authUuid' | 'authAccessToken' | 'authXuid' | 'clientId' | 'userType'
>;

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
