import path from 'path';

export function playerFileIn(folder: string, name: unknown): string {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[\\/\0]/.test(name) || name !== path.basename(name)) {
    throw new Error('Nom invalide');
  }
  return path.join(folder, name);
}
