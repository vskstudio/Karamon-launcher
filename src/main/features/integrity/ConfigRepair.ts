import fs from 'fs';
import path from 'path';
import { ZipReader } from '../../shared/ZipReader.ts';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { resolveInside } from '../../shared/ZipExtract.ts';
import { normalizeOverridePath } from '../modpack/OverridesInstaller.ts';
import { repairSummary } from './RepairSummary.ts';

/** Config files are small text; anything bigger is not what a crash zero-fills. */
export const MAX_SCANNED_BYTES = 5 * 1024 * 1024;
const ROOT_FILES = ['defaultoptions.journal.json'];
const CHUNK = 64 * 1024;

export interface ConfigRepairResult {
  /** Paths relative to the game dir, forward slashes. */
  repaired: string[];
  /** Subset of `repaired` rewritten from the pack's overrides. */
  restored: string[];
  backupDir: string | null;
}

/** A crash during a write can leave a file of the right length filled with NUL bytes. */
export function isAllNul(data: Buffer): boolean {
  if (data.length === 0) return false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return false;
  }
  return true;
}

export function backupDirName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `config-corrompues-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Scanned: config/**, root defaultoptions.journal.json, resourcepacks/*.rpo. */
export function isScannedPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('config/')) return true;
  if (ROOT_FILES.includes(p)) return true;
  return /^resourcepacks\/[^/]+\.rpo$/i.test(p);
}

export function repairMessage(count: number): string {
  return repairSummary(0, count);
}

export function findNulFiles(gameDir: string): string[] {
  const found: string[] = [];
  for (const rel of listCandidates(gameDir)) {
    if (fileIsAllNul(path.join(gameDir, rel))) found.push(rel);
  }
  return found.sort();
}

/**
 * Moves every zero-filled config to `config-corrompues-<date>/` and puts the
 * pack's version back when the overrides archive has one; otherwise the file
 * stays absent and the mod writes its default on the next start.
 */
export function repairCorruptConfigs(
  gameDir: string,
  overridesZip: string | null,
  now: Date = new Date(),
): ConfigRepairResult {
  const broken = findNulFiles(gameDir);
  if (broken.length === 0) return { repaired: [], restored: [], backupDir: null };

  const backupDir = path.join(gameDir, backupDirName(now));
  const packFiles = readPackFiles(overridesZip, broken);
  const repaired: string[] = [];
  const restored: string[] = [];
  for (const rel of broken) {
    const source = path.join(gameDir, rel);
    try {
      moveAside(source, resolveInside(backupDir, rel));
    } catch {
      continue;
    }
    repaired.push(rel);
    const packData = packFiles.get(rel);
    if (!packData) continue;
    try {
      writeFileAtomic(source, packData);
      restored.push(rel);
    } catch {
      /* left absent: the mod regenerates its default */
    }
  }
  return { repaired, restored, backupDir };
}

function listCandidates(gameDir: string): string[] {
  const out: string[] = [];
  walk(path.join(gameDir, 'config'), 'config', out);
  for (const name of ROOT_FILES) {
    if (isRegularFile(path.join(gameDir, name))) out.push(name);
  }
  try {
    for (const name of fs.readdirSync(path.join(gameDir, 'resourcepacks'))) {
      const rel = `resourcepacks/${name}`;
      if (isScannedPath(rel) && isRegularFile(path.join(gameDir, rel))) out.push(rel);
    }
  } catch {
    /* no resourcepacks dir */
  }
  return out;
}

function walk(dir: string, rel: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel, out);
    else if (entry.isFile()) out.push(childRel);
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Reads in chunks and stops at the first non-NUL byte. */
function fileIsAllNul(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0 || size > MAX_SCANNED_BYTES) return false;
    const buffer = Buffer.alloc(Math.min(CHUNK, size));
    let position = 0;
    while (position < size) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (read <= 0) break;
      if (!isAllNul(buffer.subarray(0, read))) return false;
      position += read;
    }
    return position === size;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function readPackFiles(overridesZip: string | null, wanted: string[]): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (!overridesZip || !fs.existsSync(overridesZip)) return files;
  const want = new Set(wanted);
  try {
    ZipReader.with(overridesZip, (zip) => {
      for (const entry of zip.entries) {
        if (entry.isDirectory) continue;
        const rel = normalizeOverridePath(entry.entryName);
        if (!want.has(rel)) continue;
        const data = zip.read(entry);
        if (!isAllNul(data)) files.set(rel, data);
      }
    });
  } catch {
    /* unreadable archive: nothing to restore from */
  }
  return files;
}

function moveAside(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const dest = fs.existsSync(target) ? `${target}.${Date.now()}` : target;
  fs.renameSync(source, dest);
}
