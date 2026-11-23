import type { MinecraftProfile } from './MinecraftProfile.ts';
import { HttpClient, isSuccess, jsonBody } from '../../shared/HttpClient.ts';

const LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';

interface LoginResponse {
  access_token?: string;
  expires_in?: number;
}

interface ProfileResponse {
  id?: string;
  name?: string;
}

export interface MinecraftToken {
  accessToken: string;
  expiresAt: number;
}

export class MinecraftAuth {
  private readonly http: Pick<HttpClient, 'postJson' | 'get'>;

  constructor(http: Pick<HttpClient, 'postJson' | 'get'>) {
    this.http = http;
  }

  async login(userHash: string, xstsToken: string): Promise<MinecraftToken> {
    const res = await this.http.postJson(LOGIN_URL, { identityToken: `XBL3.0 x=${userHash};${xstsToken}` });
    if (!isSuccess(res)) {
      const body = res.body.toString('utf8');
      const detail = body ? `: ${body.slice(0, 300)}` : '';
      throw new Error(`Minecraft a refusé l'authentification (HTTP ${res.status})${detail}`);
    }
    const data = jsonBody<LoginResponse>(res, {});
    if (!data.access_token) {
      throw new Error('Réponse Minecraft invalide (jeton manquant)');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 86400;
    return { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  }

  async fetchProfile(accessToken: string): Promise<MinecraftProfile> {
    const res = await this.http.get(PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (res.status === 404) {
      throw new Error('Ce compte ne possède pas Minecraft Java Edition.');
    }
    if (!isSuccess(res)) {
      throw new Error(`Profil Minecraft introuvable (HTTP ${res.status})`);
    }
    const data = jsonBody<ProfileResponse>(res, {});
    if (!data.id || !data.name) {
      throw new Error('Profil Minecraft invalide');
    }
    return { id: data.id, name: data.name, kind: 'microsoft' };
  }
}
