import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { JarParking } from '../modpack/JarParking.ts';
import { POTATO_MODS, potatoModFor, readModId } from './PotatoMods.ts';
import {
  IRIS_RULES,
  OPTIONS_RULES,
  SODIUM_RULES,
  applyRules,
  emptyBackup,
  jsonDoc,
  keyValueDoc,
  restoreRules,
  type FileBackup,
  type Rule,
  type SettingsDoc,
} from './PotatoSettings.ts';

/**
 * Mode PC modeste on disk. While it is on, each launch (after the pack sync)
 * turns shaders off, lowers the video settings and parks the heavy client-only
 * mods as `<jar>.disabled`. What it changed is kept in .karamon-potato-state.json
 * in the game folder, so turning the mode off puts the player's values and the
 * mods back. Every step is best-effort: a missing or unreadable file is skipped.
 */

const STATE_FILE = '.karamon-potato-state.json';

interface Target {
  file: string;
  rules: Rule[];
  parse: (text: string) => SettingsDoc;
}

/**
 * A missing file is skipped: the sync writes options.txt and iris.properties
 * before the mode runs at launch, and Sodium writes its file on first start.
 */
const TARGETS: Target[] = [
  { file: 'options.txt', rules: OPTIONS_RULES, parse: (t) => keyValueDoc(t, ':') },
  { file: 'config/iris.properties', rules: IRIS_RULES, parse: (t) => keyValueDoc(t, '=') },
  { file: 'config/sodium-options.json', rules: SODIUM_RULES, parse: jsonDoc },
];

interface PotatoState {
  version: 1;
  /** Game-folder-relative file → keys the mode changed in it. */
  files: Record<string, FileBackup>;
  /** Jar names (without `.disabled`) the mode parked. */
  mods: string[];
}

export interface PotatoReport {
  /** `file: key` written (apply) or put back (restore). */
  settings: string[];
  /** Jars parked (apply) or put back (restore). */
  mods: string[];
  errors: string[];
}

function isPotatoJar(jarPath: string, fileName: string): boolean {
  const mod = potatoModFor(fileName);
  return mod !== null && readModId(jarPath) === mod.id;
}

export class PotatoMode {
  /** Jars currently parked in this game folder, for ModpackSync. */
  static parkedJars(gameDir: string): string[] {
    return PotatoMode.readState(gameDir).mods;
  }

  /** Mode on: applies it. Mode off: puts back whatever it changed. */
  static reconcile(gameDir: string, enabled: boolean): PotatoReport {
    return enabled ? PotatoMode.apply(gameDir) : PotatoMode.restore(gameDir);
  }

  static apply(gameDir: string): PotatoReport {
    const state = PotatoMode.readState(gameDir);
    const report: PotatoReport = { settings: [], mods: [], errors: [] };
    for (const target of TARGETS) {
      try {
        PotatoMode.applyTarget(gameDir, target, state, report);
      } catch (e) {
        report.errors.push(`${target.file}: ${(e as Error).message}`);
      }
    }
    PotatoMode.parkMods(gameDir, state, report);
    PotatoMode.writeState(gameDir, state, report);
    return report;
  }

  static restore(gameDir: string): PotatoReport {
    const state = PotatoMode.readState(gameDir);
    const report: PotatoReport = { settings: [], mods: [], errors: [] };
    for (const [file, backup] of Object.entries(state.files)) {
      const target = TARGETS.find((t) => t.file === file);
      if (!target) continue;
      try {
        const full = path.join(gameDir, file);
        if (!fs.existsSync(full)) continue;
        const doc = target.parse(fs.readFileSync(full, 'utf8'));
        const restored = restoreRules(doc, backup);
        if (restored.length > 0) writeFileAtomic(full, doc.serialize());
        report.settings.push(...restored.map((key) => `${file}: ${key}`));
      } catch (e) {
        report.errors.push(`${file}: ${(e as Error).message}`);
      }
    }
    state.files = {};
    state.mods = PotatoMode.unparkMods(gameDir, state.mods, report);
    PotatoMode.writeState(gameDir, state, report);
    return report;
  }

  private static applyTarget(gameDir: string, target: Target, state: PotatoState, report: PotatoReport): void {
    const full = path.join(gameDir, target.file);
    if (!fs.existsSync(full)) return;
    const doc = target.parse(fs.readFileSync(full, 'utf8'));
    const backup = state.files[target.file] ?? emptyBackup();
    const written = applyRules(doc, target.rules, backup);
    if (Object.keys(backup.before).length > 0) state.files[target.file] = backup;
    if (written.length === 0) return;
    writeFileAtomic(full, doc.serialize());
    report.settings.push(...written.map((key) => `${target.file}: ${key}`));
  }

  private static parkMods(gameDir: string, state: PotatoState, report: PotatoReport): void {
    state.mods = JarParking.park(gameDir, state.mods, isPotatoJar, report);
  }

  private static unparkMods(gameDir: string, names: string[], report: PotatoReport): string[] {
    return JarParking.unpark(gameDir, names, report);
  }

  private static readState(gameDir: string): PotatoState {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(gameDir, STATE_FILE), 'utf8')) as Partial<PotatoState>;
      const files: Record<string, FileBackup> = {};
      for (const [file, backup] of Object.entries(raw.files ?? {})) {
        if (backup && typeof backup.before === 'object' && typeof backup.applied === 'object') {
          files[file] = { before: { ...backup.before }, applied: { ...backup.applied } };
        }
      }
      const mods = Array.isArray(raw.mods) ? raw.mods.filter((m): m is string => typeof m === 'string') : [];
      return { version: 1, files, mods };
    } catch {
      return { version: 1, files: {}, mods: [] };
    }
  }

  private static writeState(gameDir: string, state: PotatoState, report: PotatoReport): void {
    const file = path.join(gameDir, STATE_FILE);
    try {
      if (Object.keys(state.files).length === 0 && state.mods.length === 0) {
        fs.rmSync(file, { force: true });
      } else {
        writeFileAtomic(file, JSON.stringify(state, null, 2));
      }
    } catch (e) {
      report.errors.push(`${STATE_FILE}: ${(e as Error).message}`);
    }
  }
}

/** Short French summary of a report for the launcher console. */
export function potatoSummary(enabled: boolean, report: PotatoReport): string {
  const parts: string[] = [];
  if (report.settings.length > 0) {
    parts.push(`${report.settings.length} réglage(s) ${enabled ? 'baissé(s)' : 'remis'}`);
  }
  if (report.mods.length > 0) {
    const names = report.mods.map((jar) => {
      const mod = POTATO_MODS.find((m) => m.file.test(jar));
      return mod ? mod.label.replace(/ \(.*\)$/, '') : jar;
    });
    parts.push(`${enabled ? 'désactivé' : 'réactivé'} : ${names.join(', ')}`);
  }
  const head = enabled ? 'Mode PC modeste actif' : 'Mode PC modeste coupé';
  return parts.length > 0 ? `${head} : ${parts.join(' ; ')}.` : `${head}.`;
}
