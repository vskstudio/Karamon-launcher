import fs from 'fs';

export const cannotMakeFilesInaccessible = process.platform === 'win32' || process.getuid?.() === 0;

export function makeInaccessible(file: string): void {
  fs.chmodSync(file, 0o000);
}

export function makeAccessible(file: string): void {
  fs.chmodSync(file, 0o644);
}
