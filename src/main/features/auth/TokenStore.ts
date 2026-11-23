import { app, safeStorage } from 'electron/main';
import type { MinecraftProfile } from './MinecraftProfile';
import { JsonFile, jsonObject } from '../../shared/DurableFile.ts';

interface StoredSession {
  refreshTokenEnc: string;
  profile: MinecraftProfile;
  savedAt: number;
}

export class TokenStore {
  private readonly file: JsonFile<StoredSession>;

  constructor(file: string) {
    this.file = new JsonFile(file, TokenStore.decode, { whenUnreadable: 'replace' });
  }

  static preferLinuxSecretService(): void {
    if (process.platform !== 'linux') return;
    if (app.commandLine.hasSwitch('password-store')) return;
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  }

  async save(refreshToken: string, profile: MinecraftProfile): Promise<void> {
    if (!(await TokenStore.encryptionAvailable())) {
      throw new Error('Stockage chiffré indisponible sur ce système');
    }
    const encrypted = (await safeStorage.encryptStringAsync(refreshToken)).toString('base64');
    const data: StoredSession = { refreshTokenEnc: encrypted, profile, savedAt: Date.now() };
    this.file.write(data);
  }

  storedProfile(): MinecraftProfile | null {
    const stored = this.read();
    return stored ? { id: stored.profile.id, name: stored.profile.name, kind: 'microsoft' } : null;
  }

  async refreshToken(): Promise<string | null> {
    const stored = this.read();
    if (!stored || !(await TokenStore.encryptionAvailable())) return null;
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(stored.refreshTokenEnc, 'base64'));
      return result;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.file.remove();
  }

  private read(): StoredSession | null {
    const state = this.file.read();
    return state.kind === 'read' ? state.value : null;
  }

  private static decode(raw: unknown): StoredSession {
    const stored = jsonObject(raw) as Partial<StoredSession>;
    if (!stored.refreshTokenEnc || !stored.profile?.id || !stored.profile?.name) throw new Error('session incomplète');
    return stored as StoredSession;
  }

  private static async encryptionAvailable(): Promise<boolean> {
    if (await safeStorage.isAsyncEncryptionAvailable()) return true;
    if (process.platform !== 'linux' || !app.isReady()) return false;
    if (safeStorage.getSelectedStorageBackend() !== 'basic_text') return false;
    safeStorage.setUsePlainTextEncryption(true);
    return await safeStorage.isAsyncEncryptionAvailable();
  }
}
