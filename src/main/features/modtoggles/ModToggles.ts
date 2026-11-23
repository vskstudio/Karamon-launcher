import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { ZipReader } from '../../shared/ZipReader.ts';
import { PARKED_JAR_SUFFIX, type GameInstance } from '../../shared/GameInstance.ts';

export interface ToggledMod {
  id: string;
  label: string;
  file: RegExp;
}

export interface ToggleReason {
  key: string;
  mods: ToggledMod[];
}

export interface ActiveReason {
  reason: ToggleReason;
  active: boolean;
}

export interface ReasonChanges {
  parked: string[];
  unparked: string[];
  errors: string[];
}

export function readModId(jarPath: string): string | null {
  try {
    return ZipReader.with(jarPath, (zip) => {
      const entry = zip.entries.find((e) => e.entryName === 'fabric.mod.json');
      if (!entry) return null;
      const json = JSON.parse(zip.read(entry).toString('utf8')) as { id?: unknown };
      return typeof json.id === 'string' ? json.id : null;
    });
  } catch {
    return null;
  }
}

export function toggledModFor(mods: ToggledMod[], fileName: string): ToggledMod | null {
  if (!fileName.toLowerCase().endsWith('.jar')) return null;
  return mods.find((mod) => mod.file.test(fileName)) ?? null;
}

export class ModToggles {
  private readonly instance: GameInstance;

  constructor(instance: GameInstance) {
    this.instance = instance;
  }

  parkedJars(): Set<string> {
    return new Set(this.readParked().map((name) => name.toLowerCase()));
  }

  reconcile(reasons: ActiveReason[], packJars: Set<string> | null): Map<string, ReasonChanges> {
    if (reasons.length === 0) return new Map();
    const changes = new Map<string, ReasonChanges>(
      reasons.map(({ reason }) => [reason.key, { parked: [], unparked: [], errors: [] }]),
    );
    const active = reasons.filter((r) => r.active).map((r) => r.reason);
    const inactive = reasons.filter((r) => !r.active).map((r) => r.reason);
    const changesFor = (candidates: ToggleReason[], jar: string): ReasonChanges => {
      const owner = candidates.find((reason) => toggledModFor(reason.mods, jar)) ?? reasons[0].reason;
      return changes.get(owner.key)!;
    };

    const before = this.readParked();
    const parked = new Map(before.map((name) => [name.toLowerCase(), name]));
    for (const [lower, name] of [...parked]) {
      const inPack = !packJars || packJars.has(lower);
      const wanted = inPack && active.some((reason) => toggledModFor(reason.mods, name));
      if (wanted) continue;
      const outcome = this.unpark(name, inPack);
      if (outcome.error) {
        changesFor(inactive, name).errors.push(outcome.error);
        continue;
      }
      parked.delete(lower);
      if (outcome.unparked) changesFor(inactive, name).unparked.push(name);
    }

    for (const file of this.packJarFiles(packJars)) {
      const reason = active.find((r) => this.isTarget(r, file));
      if (!reason) continue;
      const jar = path.join(this.instance.modsDir, file);
      try {
        fs.renameSync(jar, jar + PARKED_JAR_SUFFIX);
      } catch (e) {
        changes.get(reason.key)!.errors.push(`${file}: ${(e as Error).message}`);
        continue;
      }
      parked.set(file.toLowerCase(), file);
      changes.get(reason.key)!.parked.push(file);
    }

    const kept = [...parked.values()];
    if (!sameNames(kept, before) || !fs.existsSync(this.instance.modTogglesState)) {
      const stateError = this.writeParked(kept);
      if (stateError) changes.get(reasons[0].reason.key)!.errors.push(stateError);
    }
    return changes;
  }

  private isTarget(reason: ToggleReason, file: string): boolean {
    const mod = toggledModFor(reason.mods, file);
    return mod !== null && readModId(path.join(this.instance.modsDir, file)) === mod.id;
  }

  private packJarFiles(packJars: Set<string> | null): string[] {
    try {
      return fs
        .readdirSync(this.instance.modsDir)
        .filter((file) => file.toLowerCase().endsWith('.jar'))
        .filter((file) => !packJars || packJars.has(file.toLowerCase()));
    } catch {
      return [];
    }
  }

  private unpark(name: string, stillInPack: boolean): { unparked: boolean; error?: string } {
    const jar = this.instance.installedModFile(name, false);
    const parked = this.instance.installedModFile(name, true);
    try {
      if (!stillInPack || fs.existsSync(jar)) {
        fs.rmSync(parked, { force: true });
        return { unparked: stillInPack };
      }
      if (!fs.existsSync(parked)) return { unparked: false };
      fs.renameSync(parked, jar);
      return { unparked: true };
    } catch (e) {
      return { unparked: false, error: `${name}: ${(e as Error).message}` };
    }
  }

  private readParked(): string[] {
    const own = readModList(this.instance.modTogglesState, 'parked');
    if (own) return own;
    const legacy = [
      ...(readModList(this.instance.potatoState, 'mods') ?? []),
      ...(readModList(this.instance.legacySodiumState, 'mods') ?? []),
    ];
    return [...new Map(legacy.map((name) => [name.toLowerCase(), name])).values()];
  }

  private writeParked(names: string[]): string | null {
    const file = this.instance.modTogglesState;
    try {
      writeFileAtomic(file, JSON.stringify({ version: 1, parked: names }, null, 2));
      fs.rmSync(this.instance.legacySodiumState, { force: true });
      return null;
    } catch (e) {
      return `${path.basename(file)}: ${(e as Error).message}`;
    }
  }
}

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function readModList(file: string, field: string): string[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[field] : undefined;
  return Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : null;
}
