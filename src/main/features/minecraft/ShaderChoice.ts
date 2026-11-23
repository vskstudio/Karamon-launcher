import fs from 'fs';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import { crc32File } from '../integrity/FileVerifier.ts';
import type { OptionsWriter } from './OptionsWriter.ts';

interface ShaderState {
  revision: number;
  settingsCrc: Record<string, number>;
}

export class ShaderPolicy {
  private readonly instance: GameInstance;
  private readonly state: ShaderState | null;
  private readonly settings: Record<string, number>;
  private revision = 0;
  private savedRevision: number | null = null;

  constructor(instance: GameInstance) {
    this.instance = instance;
    this.state = ShaderPolicy.readState(instance);
    this.settings = { ...(this.state?.settingsCrc ?? {}) };
  }

  setRevision(revision: number): void {
    this.revision = revision;
  }

  get bumped(): boolean {
    return this.state !== null && this.revision > this.state.revision;
  }

  async keepSettings(target: string, packCrc: number | null): Promise<boolean> {
    const key = this.instance.relative(target);
    const recorded = this.settings[key];
    if (packCrc !== null) this.settings[key] = packCrc;
    if (!fs.existsSync(target)) return false;
    if (this.bumped) return false;
    if (!this.state || packCrc === null) return true;
    let disk: number;
    try {
      disk = await crc32File(target);
    } catch {
      return false;
    }
    if (disk === packCrc) return true;
    const untouchedPreviousPackVersion = recorded !== undefined && disk === recorded;
    return !untouchedPreviousPackVersion;
  }

  applyChoice(writer: OptionsWriter, shaderPack: string, enableShaders: boolean, revision: number): boolean {
    this.setRevision(revision);
    const apply = this.bumped || this.selectedShader() === null;
    if (apply) writer.ensureShader(shaderPack, enableShaders);
    this.savedRevision = apply || !this.state ? revision : Math.max(this.state.revision, 0);
    return apply;
  }

  save(): string | null {
    const state: ShaderState = {
      revision: this.savedRevision ?? this.state?.revision ?? this.revision,
      settingsCrc: this.settings,
    };
    try {
      writeFileAtomic(this.instance.shaderState, JSON.stringify(state));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  private selectedShader(): string | null {
    try {
      const text = fs.readFileSync(this.instance.irisProperties, 'utf8');
      const value = text.match(/^shaderPack=(.*?)\r?$/m)?.[1]?.trim();
      return value ? value : null;
    } catch {
      return null;
    }
  }

  private static readState(instance: GameInstance): ShaderState | null {
    try {
      const raw = JSON.parse(fs.readFileSync(instance.shaderState, 'utf8')) as Partial<ShaderState>;
      return {
        revision: typeof raw.revision === 'number' ? raw.revision : 0,
        settingsCrc: raw.settingsCrc && typeof raw.settingsCrc === 'object' ? raw.settingsCrc : {},
      };
    } catch {
      return null;
    }
  }
}
