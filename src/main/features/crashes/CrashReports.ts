import fs from 'fs';
import path from 'path';
import { playerFileIn } from '../../shared/PlayerFileName.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

export interface CrashReport {
  name: string;
  mtime: number;
  size: number;
  summary: string;
  excerpt: string;
}

export interface CrashReportsListResult {
  dir: string;
  reports: CrashReport[];
}

const CAUSE_PATTERNS: Array<{ regex: RegExp; tag: string }> = [
  { regex: /java\.lang\.OutOfMemoryError/i, tag: 'Mémoire insuffisante (OOM)' },
  { regex: /java\.lang\.NoSuchMethodError/i, tag: 'Mod incompatible (NoSuchMethod)' },
  { regex: /java\.lang\.NoClassDefFoundError/i, tag: 'Mod manquant (NoClassDefFound)' },
  { regex: /Mixin (.+) failed/i, tag: 'Mixin échoué' },
  { regex: /Mod \S+ requires/i, tag: 'Dépendance de mod manquante' },
  { regex: /UnsatisfiedLinkError/i, tag: 'Native lib manquante' },
  { regex: /OpenGL/i, tag: 'Erreur GPU/OpenGL' },
  { regex: /Pixel format not accelerated/i, tag: 'Driver GPU' },
];

export function isCrashReportName(name: string): boolean {
  return name.endsWith('.txt');
}

export function summarizeCrash(content: string): string {
  for (const { regex, tag } of CAUSE_PATTERNS) {
    if (regex.test(content)) return tag;
  }
  const desc = content.match(/Description:\s*(.+)/);
  if (desc) return desc[1].trim().slice(0, 80);
  return 'Crash inconnu';
}

export class CrashReports {
  list(instance: GameInstance): CrashReportsListResult {
    const dir = instance.crashReportsDir;
    if (!fs.existsSync(dir)) return { dir, reports: [] };

    const reports: CrashReport[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!isCrashReportName(name)) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        const content = fs.readFileSync(full, 'utf8');
        reports.push({
          name,
          mtime: stat.mtimeMs,
          size: stat.size,
          summary: summarizeCrash(content),
          excerpt: CrashReports.excerpt(content),
        });
      } catch {
        continue;
      }
    }
    reports.sort((a, b) => b.mtime - a.mtime);
    return { dir, reports };
  }

  read(instance: GameInstance, name: string): string {
    return fs.readFileSync(this.reportPath(instance, name), 'utf8');
  }

  delete(instance: GameInstance, name: string): CrashReportsListResult {
    fs.rmSync(this.reportPath(instance, name), { force: true });
    return this.list(instance);
  }

  reportPath(instance: GameInstance, name: string): string {
    return playerFileIn(instance.crashReportsDir, name);
  }

  private static excerpt(content: string): string {
    const lines = content.split('\n');
    const start = lines.findIndex((l) => /Description:/.test(l));
    if (start === -1) return lines.slice(0, 30).join('\n');
    return lines.slice(start, start + 40).join('\n');
  }
}
