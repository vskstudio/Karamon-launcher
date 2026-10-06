import fs from 'fs';
import path from 'path';
import { crc32File } from '../integrity/FileVerifier.ts';
import type { OptionsWriter } from './OptionsWriter.ts';

/**
 * Keeps the player's shader choices across launches and pack updates.
 *
 * Before, every launch rewrote config/iris.properties (shaderPack, enableShaders)
 * and every pack sync reinstalled shaderpacks/*.txt (the per-shader settings),
 * so whatever the player picked in game was lost. Now:
 * - the pack's shader is selected when no shader is selected yet (first
 *   install), or once when the pack raises `shaderRevision` in
 *   client-options.json (an update that must impose it). A selected shader
 *   missing from shaderpacks/ is left alone: EuphoriaPatcher creates its
 *   patched packs only when the game starts;
 * - a settings file the pack ships is replaced only when it is missing, on such
 *   a revision bump, or when the player never touched it (it still holds the
 *   pack's previous version). A file the player edited stays as it is, and
 *   files the pack does not ship are never touched.
 *
 * What was last applied lives in .karamon-shader-state.json in the game folder.
 */

interface ShaderState {
  /** shaderRevision of client-options.json when the pack's choice was last applied. */
  revision: number;
  /** Settings file (relative to the game folder) → CRC-32 of the pack's version last seen. */
  settingsCrc: Record<string, number>;
}

const STATE_FILE = '.karamon-shader-state.json';

export class ShaderPolicy {
  private readonly gameDir: string;
  private readonly state: ShaderState | null;
  private readonly settings: Record<string, number>;
  private revision = 0;
  private savedRevision: number | null = null;

  constructor(gameDir: string) {
    this.gameDir = gameDir;
    this.state = ShaderPolicy.readState(gameDir);
    this.settings = { ...(this.state?.settingsCrc ?? {}) };
  }

  /** The pack's current shaderRevision (0 when client-options.json has none). */
  setRevision(revision: number): void {
    this.revision = revision;
  }

  /** The pack raised shaderRevision since its choice was last applied. */
  get bumped(): boolean {
    return this.state !== null && this.revision > this.state.revision;
  }

  /** shaderpacks/*.txt: Iris keeps one settings file per shader pack there. */
  static isSettingsFile(name: string): boolean {
    return name.toLowerCase().endsWith('.txt');
  }

  /**
   * True when the installed settings file must be kept as it is. `packCrc` is
   * the CRC-32 of the pack's version, or null when unknown (loose downloads).
   */
  async keepSettings(target: string, packCrc: number | null): Promise<boolean> {
    const key = path.relative(this.gameDir, target).replace(/\\/g, '/');
    const recorded = this.settings[key];
    if (packCrc !== null) this.settings[key] = packCrc;
    if (!fs.existsSync(target)) return false;
    if (this.bumped) return false;
    // First sync with this launcher: no record of what was installed, the player's file wins.
    if (!this.state || packCrc === null) return true;
    let disk: number;
    try {
      disk = await crc32File(target);
    } catch {
      return false;
    }
    if (disk === packCrc) return true;
    // Still the pack's previous version: the player never touched it, take the update.
    if (recorded !== undefined && disk === recorded) return false;
    return true;
  }

  /**
   * Selects the pack's shader in Iris when it has to (see class comment);
   * otherwise leaves the player's shader and on/off switch alone.
   */
  applyChoice(writer: OptionsWriter, shaderPack: string, enableShaders: boolean, revision: number): boolean {
    this.setRevision(revision);
    const apply = this.mustApply();
    if (apply) writer.ensureShader(shaderPack, enableShaders);
    this.savedRevision = apply || !this.state ? revision : Math.max(this.state.revision, 0);
    return apply;
  }

  save(): void {
    const state: ShaderState = {
      revision: this.savedRevision ?? this.state?.revision ?? this.revision,
      settingsCrc: this.settings,
    };
    try {
      fs.writeFileSync(path.join(this.gameDir, STATE_FILE), JSON.stringify(state));
    } catch {
      /* best-effort: worst case the pack's choice is applied once more */
    }
  }

  private mustApply(): boolean {
    if (this.bumped) return true;
    // A selected shader missing from shaderpacks/ is kept: EuphoriaPatcher builds
    // its patched packs when the game starts, after the launcher has run.
    return this.selectedShader() === null;
  }

  /** `shaderPack=` of config/iris.properties, or null when none is selected. */
  private selectedShader(): string | null {
    try {
      const text = fs.readFileSync(path.join(this.gameDir, 'config', 'iris.properties'), 'utf8');
      const value = text.match(/^shaderPack=(.*?)\r?$/m)?.[1]?.trim();
      return value ? value : null;
    } catch {
      return null;
    }
  }

  private static readState(gameDir: string): ShaderState | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(gameDir, STATE_FILE), 'utf8')) as Partial<ShaderState>;
      return {
        revision: typeof raw.revision === 'number' ? raw.revision : 0,
        settingsCrc: raw.settingsCrc && typeof raw.settingsCrc === 'object' ? raw.settingsCrc : {},
      };
    } catch {
      return null;
    }
  }
}
