import fs from 'fs';
import path from 'path';
import { tempPathFor } from '../../shared/AtomicWrite.ts';
import { playerFileIn } from '../../shared/PlayerFileName.ts';
import { ZipWriter } from './ZipWriter.ts';

export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface BackupListResult {
  dir: string;
  backups: BackupEntry[];
}

const TARGETS = ['saves', 'config'];
const MAX_KEPT = 10;

export class Backup {
  private readonly backupDir: string;
  private readonly isGameRunning: () => boolean;
  private creating = false;

  constructor(backupsDir: string, isGameRunning: () => boolean) {
    this.backupDir = backupsDir;
    this.isGameRunning = isGameRunning;
  }

  async create(gameDir: string): Promise<BackupEntry> {
    if (this.isGameRunning()) throw new Error('Ferme le jeu avant de sauvegarder tes mondes : il est encore en train de les écrire.');
    if (this.creating) throw new Error('Une sauvegarde est déjà en cours.');
    this.creating = true;
    try {
      return await this.writeBackup(gameDir);
    } finally {
      this.creating = false;
    }
  }

  list(): BackupListResult {
    if (!fs.existsSync(this.backupDir)) return { dir: this.backupDir, backups: [] };
    const backups: BackupEntry[] = [];
    for (const name of fs.readdirSync(this.backupDir)) {
      if (!name.endsWith('.zip')) continue;
      const full = path.join(this.backupDir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        backups.push({ name, path: full, size: stat.size, mtime: stat.mtimeMs });
      } catch {
        continue;
      }
    }
    backups.sort((a, b) => b.mtime - a.mtime);
    return { dir: this.backupDir, backups };
  }

  delete(name: string): BackupListResult {
    fs.rmSync(playerFileIn(this.backupDir, name), { force: true });
    return this.list();
  }

  private async writeBackup(gameDir: string): Promise<BackupEntry> {
    const targets = TARGETS.filter((target) => fs.existsSync(path.join(gameDir, target)));
    if (targets.length === 0) throw new Error('Aucun dossier à sauvegarder (saves/, config/)');

    await fs.promises.mkdir(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(this.backupDir, `karamon-${stamp}.zip`);
    const partial = tempPathFor(filePath);
    const zip = await ZipWriter.create(partial);
    try {
      for (const target of targets) await Backup.addFolder(zip, path.join(gameDir, target), target);
      await zip.finish();
      await fs.promises.rename(partial, filePath);
    } catch (e) {
      await zip.abort();
      await fs.promises.rm(partial, { force: true });
      throw e;
    }

    this.prune();
    const stat = await fs.promises.stat(filePath);
    return { name: path.basename(filePath), path: filePath, size: stat.size, mtime: stat.mtimeMs };
  }

  private static async addFolder(zip: ZipWriter, folder: string, entryName: string): Promise<void> {
    const stat = await fs.promises.stat(folder);
    await zip.addDirectory(entryName, stat.mtime);
    for (const child of await fs.promises.readdir(folder, { withFileTypes: true })) {
      const childPath = path.join(folder, child.name);
      const childEntry = `${entryName}/${child.name}`;
      if (child.isDirectory()) await Backup.addFolder(zip, childPath, childEntry);
      else if (child.isFile()) await zip.addFile(childPath, childEntry);
    }
  }

  private prune(): void {
    for (const backup of this.list().backups.slice(MAX_KEPT)) {
      try {
        fs.rmSync(backup.path, { force: true });
      } catch {
        continue;
      }
    }
  }
}
