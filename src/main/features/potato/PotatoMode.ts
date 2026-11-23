import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { GameInstance } from '../../shared/GameInstance.ts';
import { POTATO_MODS } from './PotatoMods.ts';
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

interface Target {
  file: string;
  rules: Rule[];
  parse: (text: string) => SettingsDoc;
}

const TARGETS: Target[] = [
  { file: 'options.txt', rules: OPTIONS_RULES, parse: (t) => keyValueDoc(t, ':') },
  { file: 'config/iris.properties', rules: IRIS_RULES, parse: (t) => keyValueDoc(t, '=') },
  { file: 'config/sodium-options.json', rules: SODIUM_RULES, parse: jsonDoc },
];

interface PotatoState {
  version: 1;
  files: Record<string, FileBackup>;
}

export interface PotatoSettingsReport {
  settings: string[];
  errors: string[];
}

export interface PotatoReport extends PotatoSettingsReport {
  mods: string[];
}

export class PotatoMode {

  static applySettings(instance: GameInstance): PotatoSettingsReport {
    const state = PotatoMode.readState(instance);
    const report: PotatoSettingsReport = { settings: [], errors: [] };
    for (const target of TARGETS) {
      try {
        PotatoMode.applyTarget(instance, target, state, report);
      } catch (e) {
        report.errors.push(`${target.file}: ${(e as Error).message}`);
      }
    }
    PotatoMode.writeState(instance, state, report);
    return report;
  }

  static restoreSettings(instance: GameInstance): PotatoSettingsReport {
    const state = PotatoMode.readState(instance);
    const report: PotatoSettingsReport = { settings: [], errors: [] };
    for (const [file, backup] of Object.entries(state.files)) {
      const target = TARGETS.find((t) => t.file === file);
      if (!target) continue;
      try {
        const full = path.join(instance.dir, file);
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
    PotatoMode.writeState(instance, state, report);
    return report;
  }

  private static applyTarget(
    instance: GameInstance,
    target: Target,
    state: PotatoState,
    report: PotatoSettingsReport,
  ): void {
    const full = path.join(instance.dir, target.file);
    if (!fs.existsSync(full)) return;
    const doc = target.parse(fs.readFileSync(full, 'utf8'));
    const backup = state.files[target.file] ?? emptyBackup();
    const written = applyRules(doc, target.rules, backup);
    if (Object.keys(backup.before).length > 0) state.files[target.file] = backup;
    if (written.length === 0) return;
    writeFileAtomic(full, doc.serialize());
    report.settings.push(...written.map((key) => `${target.file}: ${key}`));
  }

  private static readState(instance: GameInstance): PotatoState {
    try {
      const raw = JSON.parse(fs.readFileSync(instance.potatoState, 'utf8')) as Partial<PotatoState>;
      const files: Record<string, FileBackup> = {};
      for (const [file, backup] of Object.entries(raw.files ?? {})) {
        if (backup && typeof backup.before === 'object' && typeof backup.applied === 'object') {
          files[file] = { before: { ...backup.before }, applied: { ...backup.applied } };
        }
      }
      return { version: 1, files };
    } catch {
      return { version: 1, files: {} };
    }
  }

  private static writeState(instance: GameInstance, state: PotatoState, report: PotatoSettingsReport): void {
    const file = instance.potatoState;
    try {
      if (Object.keys(state.files).length === 0) fs.rmSync(file, { force: true });
      else writeFileAtomic(file, JSON.stringify(state, null, 2));
    } catch (e) {
      report.errors.push(`${path.basename(file)}: ${(e as Error).message}`);
    }
  }
}

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
