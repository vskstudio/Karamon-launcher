import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron/main';
import type { MinecraftProfile } from './MinecraftProfile';

interface StoredSession {
  refreshTokenEnc: string;
  profile: MinecraftProfile;
  savedAt: number;
}

export class TokenStore {
  constructor(private readonly file: string) {}

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
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
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
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }

  private read(): StoredSession | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredSession;
      if (!raw?.refreshTokenEnc || !raw?.profile?.id || !raw?.profile?.name) return null;
      return raw;
    } catch {
      return null;
    }
  }

  private static async encryptionAvailable(): Promise<boolean> {
    if (await safeStorage.isAsyncEncryptionAvailable()) return true;
    if (process.platform !== 'linux' || !app.isReady()) return false;
    if (safeStorage.getSelectedStorageBackend() !== 'basic_text') return false;
    safeStorage.setUsePlainTextEncryption(true);
    return await safeStorage.isAsyncEncryptionAvailable();
  }
}
