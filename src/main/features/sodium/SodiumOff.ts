import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { JarParking, type ParkingReport } from '../modpack/JarParking.ts';
import { readModId } from '../potato/PotatoMods.ts';

const STATE_FILE = '.karamon-sodium-state.json';

interface SodiumMod {
  id: string;
  label: string;
  file: RegExp;
}

export const SODIUM_MODS: SodiumMod[] = [
  { id: 'sodium', label: 'Sodium', file: /^sodium-fabric-/i },
  { id: 'iris', label: 'Iris', file: /^iris-/i },
  { id: 'voxy', label: 'Voxy', file: /^voxy-\d/i },
  { id: 'sodium-extra', label: 'Sodium Extra', file: /^sodium-extra-/i },
  { id: 'reeses-sodium-options', label: "Reese's Sodium Options", file: /^reeses-sodium-options-/i },
];

function sodiumModFor(fileName: string): SodiumMod | null {
  return SODIUM_MODS.find((mod) => mod.file.test(fileName)) ?? null;
}

function isSodiumJar(jarPath: string, fileName: string): boolean {
  const mod = sodiumModFor(fileName);
  return mod !== null && readModId(jarPath) === mod.id;
}

export class SodiumOff {
  static parkedJars(gameDir: string): string[] {
    return SodiumOff.readParked(gameDir);
  }

  static reconcile(gameDir: string, disabled: boolean): ParkingReport {
    return disabled ? SodiumOff.apply(gameDir) : SodiumOff.restore(gameDir);
  }

  static apply(gameDir: string): ParkingReport {
    const report: ParkingReport = { mods: [], errors: [] };
    const parked = JarParking.park(gameDir, SodiumOff.readParked(gameDir), isSodiumJar, report);
    SodiumOff.writeParked(gameDir, parked, report);
    return report;
  }

  static restore(gameDir: string): ParkingReport {
    const report: ParkingReport = { mods: [], errors: [] };
    const left = JarParking.unpark(gameDir, SodiumOff.readParked(gameDir), report);
    SodiumOff.writeParked(gameDir, left, report);
    return report;
  }

  private static readParked(gameDir: string): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(gameDir, STATE_FILE), 'utf8')) as { mods?: unknown };
      return Array.isArray(raw.mods) ? raw.mods.filter((m): m is string => typeof m === 'string') : [];
    } catch {
      return [];
    }
  }

  private static writeParked(gameDir: string, mods: string[], report: ParkingReport): void {
    const file = path.join(gameDir, STATE_FILE);
    try {
      if (mods.length === 0) fs.rmSync(file, { force: true });
      else writeFileAtomic(file, JSON.stringify({ version: 1, mods }, null, 2));
    } catch (e) {
      report.errors.push(`${STATE_FILE}: ${(e as Error).message}`);
    }
  }
}

export function sodiumSummary(disabled: boolean, report: ParkingReport): string {
  const names = report.mods.map((jar) => sodiumModFor(jar)?.label ?? jar);
  if (disabled) {
    return names.length > 0 ? `Sodium désactivé : ${names.join(', ')}.` : 'Sodium désactivé.';
  }
  return names.length > 0 ? `Sodium réactivé : ${names.join(', ')}.` : 'Sodium réactivé.';
}
