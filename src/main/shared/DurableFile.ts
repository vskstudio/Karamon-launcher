import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './AtomicWrite.ts';

export type FileState<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'read'; readonly value: T }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type UnreadablePolicy = 'replace' | 'set-aside' | 'refuse';

export interface FileCodec<T> {
  decode(bytes: Buffer): T;
  encode(value: T): Buffer | string;
}

export interface WriteResult {
  keptUnreadableAs: string | null;
}

export class UnreadableFileError extends Error {
  readonly file: string;

  constructor(file: string, reason: string) {
    super(`${path.basename(file)} illisible, laissé tel quel (${reason})`);
    this.name = 'UnreadableFileError';
    this.file = file;
  }
}

export class DurableFile<T> {
  readonly path: string;
  private readonly codec: FileCodec<T>;
  private readonly whenUnreadable: UnreadablePolicy;

  constructor(filePath: string, codec: FileCodec<T>, whenUnreadable: UnreadablePolicy) {
    this.path = filePath;
    this.codec = codec;
    this.whenUnreadable = whenUnreadable;
  }

  read(): FileState<T> {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(this.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'unreadable', reason: reasonOf(e) };
    }
    try {
      return { kind: 'read', value: this.codec.decode(bytes) };
    } catch (e) {
      return { kind: 'unreadable', reason: reasonOf(e) };
    }
  }

  readForUpdate(): T | null {
    const state = this.read();
    if (state.kind === 'unreadable') throw new UnreadableFileError(this.path, state.reason);
    return state.kind === 'read' ? state.value : null;
  }

  write(value: T): WriteResult {
    const encoded = this.codec.encode(value);
    const keptUnreadableAs = this.makeWayForWrite();
    writeFileAtomic(this.path, encoded);
    return { keptUnreadableAs };
  }

  remove(): void {
    fs.rmSync(this.path, { force: true });
  }

  private makeWayForWrite(): string | null {
    if (this.whenUnreadable === 'replace') return null;
    const current = this.read();
    if (current.kind !== 'unreadable') return null;
    if (this.whenUnreadable === 'refuse') throw new UnreadableFileError(this.path, current.reason);
    const aside = `${this.path}.illisible-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(this.path, aside);
    return aside;
  }
}

export interface JsonFileOptions {
  whenUnreadable: UnreadablePolicy;
  indented?: boolean;
}

export class JsonFile<T> extends DurableFile<T> {
  constructor(filePath: string, decode: (raw: unknown) => T, { whenUnreadable, indented = true }: JsonFileOptions) {
    super(filePath, jsonCodec(decode, indented), whenUnreadable);
  }
}

export function jsonObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('le contenu n’est pas un objet JSON');
  return raw as Record<string, unknown>;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function jsonCodec<T>(decode: (raw: unknown) => T, indented: boolean): FileCodec<T> {
  return {
    decode: (bytes) => {
      const text = bytes.subarray(0, 3).equals(UTF8_BOM) ? bytes.subarray(3) : bytes;
      return decode(JSON.parse(text.toString('utf8')));
    },
    encode: (value) => (indented ? JSON.stringify(value, null, 2) : JSON.stringify(value)),
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
