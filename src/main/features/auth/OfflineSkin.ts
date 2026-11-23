import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { isValidOfflineName } from '../../../shared/OfflineName.ts';
import { SKIN_MAX_BYTES_ACCEPTED_BY_KARAMON_MOD } from '../../../shared/Karamon.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';

export type SkinModel = 'classic' | 'slim';

export interface OfflineSkinRequest {
  name: string;
  png: string;
  model: SkinModel;
}

function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function skinProblem(png: Buffer): string | null {
  if (png.length > SKIN_MAX_BYTES_ACCEPTED_BY_KARAMON_MOD) return 'Image trop lourde : 32 Ko au plus.';
  const size = pngSize(png);
  if (!size) return "Ce fichier n'est pas une image PNG.";
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) return 'Un skin fait 64 × 64 ou 64 × 32 pixels.';
  return null;
}

function skinFilesReadByKaramonModAtLogin(instance: GameInstance, name: string): { json: string; png: string } {
  if (!isValidOfflineName(name)) throw new Error('Pseudo invalide.');
  const base = path.join(instance.skinsDir, name.toLowerCase());
  return { json: `${base}.json`, png: `${base}.png` };
}

export function saveSkin(instance: GameInstance, name: string, png: Buffer, model: SkinModel): void {
  const problem = skinProblem(png);
  if (problem) throw new Error(problem);
  const f = skinFilesReadByKaramonModAtLogin(instance, name);
  fs.mkdirSync(path.dirname(f.png), { recursive: true });
  writeFileAtomic(f.png, png);
  writeFileAtomic(f.json, JSON.stringify({ mode: 'custom', model: model === 'slim' ? 'slim' : 'classic' }));
}

export function resetSkin(instance: GameInstance, name: string): void {
  const f = skinFilesReadByKaramonModAtLogin(instance, name);
  fs.mkdirSync(path.dirname(f.json), { recursive: true });
  fs.rmSync(f.png, { force: true });
  writeFileAtomic(f.json, JSON.stringify({ mode: 'default' }));
}

export function savedSkinDataUrl(instance: GameInstance, name: string): string | null {
  if (!isValidOfflineName(name)) return null;
  const f = skinFilesReadByKaramonModAtLogin(instance, name);
  try {
    const meta = JSON.parse(fs.readFileSync(f.json, 'utf8')) as { mode?: string };
    if (meta.mode !== 'custom') return null;
    const png = fs.readFileSync(f.png);
    return skinProblem(png) ? null : `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}
