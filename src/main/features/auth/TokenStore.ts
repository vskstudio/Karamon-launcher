import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron/main';
import type { MinecraftProfile } from '../../../ipc/contract';

interface StoredSession {
  refreshTokenEnc: string;
  profile: MinecraftProfile;
  savedAt: number;
}

export interface LoadedSession {
  refreshToken: string;
  profile: MinecraftProfile;
}

export class TokenStore {
  constructor(private readonly file: string) {}

  static preferLinuxSecretService(): void {
    if (process.platform !== 'linux') return;
    if (app.commandLine.hasSwitch('password-store')) return;
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  }

  save(refreshToken: string, profile: MinecraftProfile): void {
    if (!TokenStore.encryptionAvailable()) {
      throw new Error('Stockage chiffré indisponible sur ce système');
    }
    const encrypted = safeStorage.encryptString(refreshToken).toString('base64');
    const data: StoredSession = { refreshTokenEnc: encrypted, profile, savedAt: Date.now() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
  }

  load(): LoadedSession | null {
    if (!fs.existsSync(this.file)) return null;
    if (!TokenStore.encryptionAvailable()) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredSession;
      if (!raw?.refreshTokenEnc || !raw?.profile?.id || !raw?.profile?.name) return null;
      const refreshToken = safeStorage.decryptString(Buffer.from(raw.refreshTokenEnc, 'base64'));
      return { refreshToken, profile: raw.profile };
    } catch {
      return null;
    }
  }

  private static encryptionAvailable(): boolean {
    if (safeStorage.isEncryptionAvailable()) return true;
    if (process.platform !== 'linux' || !app.isReady()) return false;
    if (safeStorage.getSelectedStorageBackend() !== 'basic_text') return false;
    safeStorage.setUsePlainTextEncryption(true);
    return safeStorage.isEncryptionAvailable();
  }

  clear(): void {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }
}
