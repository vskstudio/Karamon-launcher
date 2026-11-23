import path from 'path';
import { JsonFile } from './DurableFile.ts';

export class JsonFileCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  read<T>(name: string): T | null {
    const state = this.fileFor(name).read();
    return state.kind === 'read' ? (state.value as T) : null;
  }

  write(name: string, value: unknown): void {
    try {
      this.fileFor(name).write(value);
    } catch {
      return;
    }
  }

  private fileFor(name: string): JsonFile<unknown> {
    return new JsonFile(path.join(this.dir, `${name}.json`), (raw) => raw, { whenUnreadable: 'replace', indented: false });
  }
}
