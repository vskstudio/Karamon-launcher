import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';

export type JsonCheck = (json: Record<string, unknown>, text: string) => boolean;

export function jsonObjectPasses(text: string, check: JsonCheck): boolean {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return false;
  }
  return !!json && typeof json === 'object' && !Array.isArray(json) && check(json as Record<string, unknown>, text);
}

export function sha1Matches(text: string, expected: string | undefined): boolean {
  if (!expected) return true;
  return crypto.createHash('sha1').update(text).digest('hex') === expected.toLowerCase();
}

export async function cachedJsonText(file: string, check: JsonCheck, fetch: () => Promise<string>): Promise<string> {
  const cached = readText(file);
  if (cached !== null && jsonObjectPasses(cached, check)) return cached;
  const text = await fetch();
  if (!jsonObjectPasses(text, check)) throw new Error(`${path.basename(file)} téléchargé invalide ou incomplet`);
  writeFileAtomic(file, text);
  return text;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
