import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { isValidOfflineName } from '../../../shared/OfflineName.ts';

/** The server refuses bigger skins (AuthPayloads.MAX_SKIN_BYTES in the Karamon mod). */
export const SKIN_MAX_BYTES = 32 * 1024;

export type SkinModel = 'classic' | 'slim';

/** Width and height of a PNG (its IHDR chunk), or null when the bytes are not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Why this file cannot be a Minecraft skin, or null when it can. */
export function skinProblem(png: Buffer): string | null {
  if (png.length > SKIN_MAX_BYTES) return 'Image trop lourde : 32 Ko au plus.';
  const size = pngSize(png);
  if (!size) return "Ce fichier n'est pas une image PNG.";
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) return 'Un skin fait 64 × 64 ou 64 × 32 pixels.';
  return null;
}

/**
 * Where the launcher leaves the skin of an offline account: `karamon/skins/<name>.json` (+ `.png`) in the game folder.
 * The Karamon mod sends it with the next login answer; the server signs it once the password is checked.
 */
function files(gameDir: string, name: string): { json: string; png: string } {
  if (!isValidOfflineName(name)) throw new Error('Pseudo invalide.');
  const base = path.join(gameDir, 'karamon', 'skins', name.toLowerCase());
  return { json: `${base}.json`, png: `${base}.png` };
}

export function saveSkin(gameDir: string, name: string, png: Buffer, model: SkinModel): void {
  const problem = skinProblem(png);
  if (problem) throw new Error(problem);
  const f = files(gameDir, name);
  fs.mkdirSync(path.dirname(f.png), { recursive: true });
  writeFileAtomic(f.png, png);
  writeFileAtomic(f.json, JSON.stringify({ mode: 'custom', model: model === 'slim' ? 'slim' : 'classic' }));
}

/** Back to the skin of Ely.by / TLauncher, or Steve: the game sends it once, then forgets it. */
export function resetSkin(gameDir: string, name: string): void {
  const f = files(gameDir, name);
  fs.mkdirSync(path.dirname(f.json), { recursive: true });
  fs.rmSync(f.png, { force: true });
  writeFileAtomic(f.json, JSON.stringify({ mode: 'default' }));
}

/** The custom skin chosen here, as a data URL for the launcher's avatar, or null. */
export function savedSkinDataUrl(gameDir: string, name: string): string | null {
  if (!isValidOfflineName(name)) return null;
  const f = files(gameDir, name);
  try {
    const meta = JSON.parse(fs.readFileSync(f.json, 'utf8')) as { mode?: string };
    if (meta.mode !== 'custom') return null;
    const png = fs.readFileSync(f.png);
    return skinProblem(png) ? null : `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}
