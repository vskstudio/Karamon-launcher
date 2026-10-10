import fs from 'fs';
import path from 'path';
import { ModpackSync, PARKED_JAR_SUFFIX } from './ModpackSync.ts';

export interface ParkingReport {
  mods: string[];
  errors: string[];
}

export type ParkTarget = (jarPath: string, fileName: string) => boolean;

export class JarParking {
  static park(gameDir: string, alreadyParked: string[], isTarget: ParkTarget, report: ParkingReport): string[] {
    const modsDir = path.join(gameDir, 'mods');
    let files: string[];
    try {
      files = fs.readdirSync(modsDir);
    } catch {
      return alreadyParked;
    }
    const pack = ModpackSync.packJars(gameDir);
    const parked = new Set(alreadyParked.map((n) => n.toLowerCase()));
    let kept = alreadyParked;

    if (pack) {
      kept = alreadyParked.filter((name) => {
        if (pack.has(name.toLowerCase())) return true;
        try {
          fs.rmSync(path.join(modsDir, name + PARKED_JAR_SUFFIX), { force: true });
          parked.delete(name.toLowerCase());
          return false;
        } catch {
          return true;
        }
      });
    }

    for (const file of files) {
      if (!file.toLowerCase().endsWith('.jar')) continue;
      if (pack && !pack.has(file.toLowerCase())) continue;
      const jar = path.join(modsDir, file);
      if (!isTarget(jar, file)) continue;
      try {
        fs.renameSync(jar, jar + PARKED_JAR_SUFFIX);
      } catch (e) {
        report.errors.push(`${file}: ${(e as Error).message}`);
        continue;
      }
      if (!parked.has(file.toLowerCase())) {
        parked.add(file.toLowerCase());
        kept = [...kept, file];
      }
      report.mods.push(file);
    }
    return kept;
  }

  static unpark(gameDir: string, names: string[], report: ParkingReport): string[] {
    const modsDir = path.join(gameDir, 'mods');
    const left: string[] = [];
    for (const name of names) {
      const jar = path.join(modsDir, name);
      const parked = jar + PARKED_JAR_SUFFIX;
      try {
        if (fs.existsSync(jar)) fs.rmSync(parked, { force: true });
        else if (fs.existsSync(parked)) fs.renameSync(parked, jar);
        else continue;
        report.mods.push(name);
      } catch (e) {
        report.errors.push(`${name}: ${(e as Error).message}`);
        left.push(name);
      }
    }
    return left;
  }
}
