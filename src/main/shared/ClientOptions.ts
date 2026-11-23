import fs from 'fs';
import path from 'path';

export interface ClientOptions {
  resourcePacks: string[];
  shaderPack: string;
  enableShaders: boolean;
  shaderRevision: number;
}

export function parseClientOptions(raw: unknown): ClientOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.resourcePacks)) return null;
  if (value.resourcePacks.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    return null;
  }
  if (typeof value.shaderPack !== 'string' || value.shaderPack.length === 0) return null;
  const revision = value.shaderRevision;
  return {
    resourcePacks: value.resourcePacks as string[],
    shaderPack: value.shaderPack,
    enableShaders: value.enableShaders !== false,
    shaderRevision: typeof revision === 'number' && Number.isInteger(revision) && revision > 0 ? revision : 0,
  };
}

export function parseClientOptionsText(text: string): ClientOptions | null {
  try {
    return parseClientOptions(JSON.parse(text));
  } catch {
    return null;
  }
}

export function loadClientOptions(distDir: string): ClientOptions | null {
  const candidates = [
    path.join(distDir, 'client-options.json'),
    path.join(distDir, '..', 'content', 'client-options.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const parsed = parseClientOptionsText(fs.readFileSync(file, 'utf8'));
    if (parsed) return parsed;
  }
  return null;
}
