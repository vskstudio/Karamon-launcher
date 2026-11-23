import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './AtomicWrite.ts';

export class JsonFileCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  read<T>(name: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(this.fileFor(name), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  write(name: string, value: unknown): void {
    try {
      writeFileAtomic(this.fileFor(name), JSON.stringify(value));
    } catch {
      return;
    }
  }

  private fileFor(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }
}
