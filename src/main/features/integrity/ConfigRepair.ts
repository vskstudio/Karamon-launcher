import fs from 'fs';
import path from 'path';
import { ZipReader } from '../../shared/ZipReader.ts';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { normalizeEntryPath, resolveInside } from '../../shared/ZipExtract.ts';
import { repairSummary } from './RepairSummary.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

const MAX_SCANNED_BYTES = 5 * 1024 * 1024;
const ROOT_FILES = ['defaultoptions.journal.json'];
const CHUNK = 64 * 1024;

export interface ConfigRepairResult {
  repaired: string[];
  restored: string[];
  backupDir: string | null;
}

function isAllNul(data: Buffer): boolean {
  if (data.length === 0) return false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return false;
  }
  return true;
}

function backupDirName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `config-corrompues-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isScannedPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('config/')) return true;
  if (ROOT_FILES.includes(p)) return true;
  return /^resourcepacks\/[^/]+\.rpo$/i.test(p);
}

export function repairMessage(count: number): string {
  return repairSummary(0, count);
}

function findNulFiles(instance: GameInstance): string[] {
  const found: string[] = [];
  for (const rel of listCandidates(instance)) {
    if (fileIsAllNul(path.join(instance.dir, rel))) found.push(rel);
  }
  return found.sort();
}

export function repairCorruptConfigs(instance: GameInstance, now: Date = new Date()): ConfigRepairResult {
  const gameDir = instance.dir;
  const broken = findNulFiles(instance);
  if (broken.length === 0) return { repaired: [], restored: [], backupDir: null };

  const backupDir = path.join(gameDir, backupDirName(now));
  const packFiles = readPackFiles(instance.keptOverridesArchive(), broken);
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
    if (restoreFromPack(source, packData)) restored.push(rel);
  }
  return { repaired, restored, backupDir };
}

function restoreFromPack(file: string, packData: Buffer): boolean {
  try {
    writeFileAtomic(file, packData);
    return true;
  } catch {
    return false;
  }
}

function listCandidates(instance: GameInstance): string[] {
  const out: string[] = [];
  walk(instance.configDir, 'config', out);
  for (const name of ROOT_FILES) {
    if (isRegularFile(path.join(instance.dir, name))) out.push(name);
  }
  for (const name of namesIn(instance.resourcePacksDir)) {
    const rel = `resourcepacks/${name}`;
    if (isScannedPath(rel) && isRegularFile(path.join(instance.dir, rel))) out.push(rel);
  }
  return out;
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
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
        const rel = normalizeEntryPath(entry.entryName);
        if (!want.has(rel)) continue;
        const data = zip.read(entry);
        if (!isAllNul(data)) files.set(rel, data);
      }
    });
    return files;
  } catch {
    return new Map();
  }
}

function moveAside(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const dest = fs.existsSync(target) ? `${target}.${Date.now()}` : target;
  fs.renameSync(source, dest);
}
