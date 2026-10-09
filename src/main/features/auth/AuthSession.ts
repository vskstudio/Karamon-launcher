import type { AuthSessionResult, MinecraftProfile } from '../../../ipc/contract';
import { offlineNameProblem } from '../../../shared/OfflineName';
import { MicrosoftAuth, type MicrosoftToken } from './MicrosoftAuth';
import { XboxAuth } from './XboxAuth';
import { MinecraftAuth, type MinecraftToken } from './MinecraftAuth';
import { TokenStore } from './TokenStore';
import { AccountStore, MICROSOFT_ACTIVE } from './AccountStore';
import { OFFLINE_ACCESS_TOKEN } from './OfflineAccount';

const REFRESH_LEEWAY_MS = 60_000;

export interface ActiveSession {
  profile: MinecraftProfile;
  accessToken: string;
  /** Minecraft's --userType: `msa` for a Microsoft account, `legacy` for an offline one. */
  userType: 'msa' | 'legacy';
  expiresAt: number;
}

export class AuthSession {
  /** The Microsoft session once its tokens are fresh. Offline accounts have no session to keep. */
  private current: ActiveSession | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly accounts: AccountStore,
    private readonly microsoft: MicrosoftAuth = new MicrosoftAuth(),
    private readonly xbox: XboxAuth = new XboxAuth(),
    private readonly minecraft: MinecraftAuth = new MinecraftAuth(),
  ) {}

  state(): AuthSessionResult {
    const microsoft = this.microsoftProfile();
    const { active, offline } = this.accounts.load();
    const offlineProfiles: MinecraftProfile[] = offline.map((a) => ({ id: a.id, name: a.name, kind: 'offline' }));
    const accounts = microsoft ? [microsoft, ...offlineProfiles] : offlineProfiles;
    const current = active === MICROSOFT_ACTIVE ? microsoft : offlineProfiles.find((a) => a.id === active) ?? null;
    return { active: current, accounts };
  }

  async login(): Promise<MinecraftProfile> {
    const ms = await this.microsoft.login();
    const session = await this.completeChain(ms);
    this.accounts.setActive(MICROSOFT_ACTIVE);
    return session.profile;
  }

  /** Remembers a player without a Minecraft licence. No network: the server asks for the Karamon password. */
  loginOffline(name: string): MinecraftProfile {
    const problem = offlineNameProblem(name);
    if (problem) throw new Error(problem);
    const entry = this.accounts.addOffline(name);
    return { id: entry.id, name: entry.name, kind: 'offline' };
  }

  switchTo(accountId: string): AuthSessionResult {
    const target = this.state().accounts.find((a) => a.id === accountId);
    if (!target) throw new Error('Ce compte n’est plus enregistré dans le launcher.');
    this.accounts.setActive(target.kind === 'microsoft' ? MICROSOFT_ACTIVE : target.id);
    return this.state();
  }

  /** The session the game is launched with. Only a Microsoft account talks to Microsoft. */
  async getActive(): Promise<ActiveSession> {
    const active = this.state().active;
    if (!active) throw new Error('Aucun compte connecté, connexion requise');
    if (active.kind === 'offline') {
      return { profile: active, accessToken: OFFLINE_ACCESS_TOKEN, userType: 'legacy', expiresAt: Number.POSITIVE_INFINITY };
    }
    if (this.current && this.current.expiresAt > Date.now() + REFRESH_LEEWAY_MS) {
      return this.current;
    }
    return await this.refresh();
  }

  /** Signs the active account out: forgets the Microsoft tokens, or the offline name. */
  logout(): AuthSessionResult {
    const active = this.state().active;
    if (!active) return this.state();
    if (active.kind === 'offline') {
      this.accounts.removeOffline(active.id);
    } else {
      this.store.clear();
      this.current = null;
      this.accounts.setActive(null);
    }
    return this.state();
  }

  private microsoftProfile(): MinecraftProfile | null {
    if (this.current) return this.current.profile;
    return this.store.load()?.profile ?? null;
  }

  private async refresh(): Promise<ActiveSession> {
    const stored = this.store.load();
    if (!stored) throw new Error('Aucune session stockée, connexion requise');
    const ms = await this.microsoft.refresh(stored.refreshToken);
    return await this.completeChain(ms);
  }

  private async completeChain(ms: MicrosoftToken): Promise<ActiveSession> {
    const xbox = await this.xbox.authenticate(ms.accessToken);
    const mc: MinecraftToken = await this.minecraft.login(xbox.userHash, xbox.token);
    const profile = await this.minecraft.fetchProfile(mc.accessToken);
    this.store.save(ms.refreshToken, profile);
    this.current = { profile, accessToken: mc.accessToken, userType: 'msa', expiresAt: mc.expiresAt };
    return this.current;
  }
}
