import fs from 'fs';
import path from 'path';
import { resolveInside } from './ZipExtract.ts';

export const PARKED_JAR_SUFFIX = '.disabled';

export interface InstalledMod {
  name: string;
  size: number;
  disabled?: boolean;
}

export interface ModsListResult {
  dir: string;
  mods: InstalledMod[];
}

let tempCounter = 0;

const TEMP_PREFIX = '.karamon-';
const TEMP_SUFFIX = '.tmp';
const LEFTOVER_TEMP_FILE = /^\.karamon-\d+-\d+-\d+-.+\.tmp(\.tmp)?$/;

export class GameInstance {
  readonly dir: string;
  readonly modsDir: string;
  readonly packDisabledModsDir: string;
  readonly configDir: string;
  readonly resourcePacksDir: string;
  readonly shaderPacksDir: string;
  readonly crashReportsDir: string;
  readonly logsDir: string;
  readonly latestLog: string;
  readonly screenshotsDir: string;
  readonly skinsDir: string;
  readonly optionsFile: string;
  readonly irisProperties: string;
  readonly syncState: string;
  readonly overridesArchive: string;
  readonly integrityCache: string;
  readonly shaderState: string;
  readonly potatoState: string;
  readonly modTogglesState: string;
  readonly legacySodiumState: string;
  readonly legacyClientOptions: string;

  constructor(dir: string) {
    this.dir = dir;
    this.modsDir = path.join(dir, 'mods');
    this.packDisabledModsDir = path.join(this.modsDir, 'mods-disabled');
    this.configDir = path.join(dir, 'config');
    this.resourcePacksDir = path.join(dir, 'resourcepacks');
    this.shaderPacksDir = path.join(dir, 'shaderpacks');
    this.crashReportsDir = path.join(dir, 'crash-reports');
    this.logsDir = path.join(dir, 'logs');
    this.latestLog = path.join(this.logsDir, 'latest.log');
    this.screenshotsDir = path.join(dir, 'screenshots');
    this.skinsDir = path.join(dir, 'karamon', 'skins');
    this.optionsFile = path.join(dir, 'options.txt');
    this.irisProperties = path.join(this.configDir, 'iris.properties');
    this.syncState = path.join(dir, '.karamon-sync-cache.json');
    this.overridesArchive = path.join(dir, '.karamon-overrides.zip');
    this.integrityCache = path.join(dir, '.karamon-integrity-cache.json');
    this.shaderState = path.join(dir, '.karamon-shader-state.json');
    this.potatoState = path.join(dir, '.karamon-potato-state.json');
    this.modTogglesState = path.join(dir, '.karamon-mod-toggles.json');
    this.legacySodiumState = path.join(dir, '.karamon-sodium-state.json');
    this.legacyClientOptions = path.join(dir, '.karamon-client-options.json');
  }

  relative(file: string): string {
    return path.relative(this.dir, file).replace(/\\/g, '/');
  }

  tempFile(label: string, inDir: string = this.dir): string {
    tempCounter = (tempCounter + 1) % 1_000_000;
    const unique = `${process.pid}-${Date.now()}-${tempCounter}`;
    return resolveInside(inDir, `${TEMP_PREFIX}${unique}-${path.basename(label)}${TEMP_SUFFIX}`);
  }

  removeLeftoverTempFiles(): number {
    let removed = 0;
    for (const dir of [this.dir, this.resourcePacksDir, this.shaderPacksDir]) {
      for (const name of filesIn(dir)) {
        if (!isLeftoverTempFile(name)) continue;
        try {
          fs.rmSync(path.join(dir, name), { force: true });
          removed++;
        } catch {
          continue;
        }
      }
    }
    return removed;
  }

  keptOverridesArchive(): string | null {
    return fs.existsSync(this.overridesArchive) ? this.overridesArchive : null;
  }

  installedModFile(name: string, parked: boolean): string {
    return resolveInside(this.modsDir, parked ? name + PARKED_JAR_SUFFIX : name);
  }

  listMods(): InstalledMod[] {
    const parkedEnd = '.jar' + PARKED_JAR_SUFFIX;
    let files: string[];
    try {
      files = fs.readdirSync(this.modsDir);
    } catch {
      return [];
    }
    return files
      .filter((file) => file.toLowerCase().endsWith('.jar') || file.toLowerCase().endsWith(parkedEnd))
      .map((file) => {
        const size = fileSize(path.join(this.modsDir, file));
        if (!file.toLowerCase().endsWith(parkedEnd)) return { name: file, size };
        return { name: file.slice(0, -PARKED_JAR_SUFFIX.length), size, disabled: true };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function isLeftoverTempFile(name: string): boolean {
  return LEFTOVER_TEMP_FILE.test(name);
}

function filesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
