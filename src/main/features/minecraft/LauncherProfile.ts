import path from 'path';
import { JsonFile, jsonObject } from '../../shared/DurableFile.ts';
import { KARAMON } from '../../../shared/Karamon.ts';

const PROFILE_FILE_VERSION = 3;
const BASE_JVM_FLAGS = '-Xms512m -XX:+UseG1GC -XX:MaxGCPauseMillis=50';

export interface ProfileSpec {
  name: string;
  versionId: string;
  gameDir: string;
  memoryMb: number;
  jvmArgs: string;
}

interface ProfileEntry {
  created?: string;
  icon?: string;
  name: string;
  type?: string;
  javaArgs?: string;
  lastVersionId?: string;
  lastUsed?: string;
  gameDir?: string;
}

interface ProfileFile {
  profiles: Record<string, ProfileEntry>;
  settings?: Record<string, unknown>;
  version?: number;
}

export class LauncherProfile {
  private readonly dir: string;
  private readonly file: JsonFile<ProfileFile>;

  constructor(mcLauncherDir: string) {
    this.dir = mcLauncherDir;
    this.file = new JsonFile(path.join(mcLauncherDir, 'launcher_profiles.json'), LauncherProfile.decode, {
      whenUnreadable: 'refuse',
    });
  }

  ensure({ name, versionId, gameDir, memoryMb, jvmArgs }: ProfileSpec): void {
    const data = this.read();
    const javaArgs = LauncherProfile.buildJavaArgs(memoryMb, jvmArgs);
    const useCustomGameDir = path.resolve(gameDir) !== path.resolve(this.dir);
    const now = new Date().toISOString();

    const existingKey = Object.keys(data.profiles).find(
      (k) => k === name || data.profiles[k]?.name === name,
    );

    const profile: ProfileEntry = existingKey
      ? data.profiles[existingKey]
      : { created: now, icon: 'Grass', name, type: 'custom' };

    profile.javaArgs = javaArgs;
    profile.lastVersionId = versionId;
    profile.lastUsed = now;
    if (useCustomGameDir) profile.gameDir = gameDir;
    else delete profile.gameDir;

    data.profiles[existingKey ?? name] = profile;

    this.file.write(data);
  }

  private read(): ProfileFile {
    return this.file.readForUpdate() ?? { profiles: {}, settings: {}, version: PROFILE_FILE_VERSION };
  }

  private static decode(raw: unknown): ProfileFile {
    const data = jsonObject(raw);
    if (data.profiles === undefined) return { ...data, profiles: {} };
    jsonObject(data.profiles);
    return data as unknown as ProfileFile;
  }

  private static buildJavaArgs(memoryMb: number, extra: string): string {
    const heap = `-Xmx${memoryMb || KARAMON.defaultMemoryMb}m`;
    const base = `${heap} ${BASE_JVM_FLAGS}`;
    return extra ? `${base} ${extra}` : base;
  }
}
