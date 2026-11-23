
export type Lower = (current: string | undefined) => string | null;

export interface Rule {
  key: string;
  lower: Lower;
}

export interface FileBackup {
  before: Record<string, string | null>;
  applied: Record<string, string>;
}

export interface SettingsDoc {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  serialize(): string;
}

export function atMost(target: string, fallback: number): Lower {
  const limit = Number(target);
  return (current) => {
    const value = current === undefined ? fallback : Number(current.trim());
    return Number.isFinite(value) && value <= limit ? null : target;
  };
}

export function atLeast(target: string, fallback: number): Lower {
  const limit = Number(target);
  return (current) => {
    const value = current === undefined ? fallback : Number(current.trim());
    return Number.isFinite(value) && value >= limit ? null : target;
  };
}

export function cheapest(order: string[], target: string, fallback: string): Lower {
  const rank = (value: string): number => order.indexOf(value);
  return (current) => {
    const value = current === undefined ? fallback : current.trim();
    const at = rank(value);
    return at !== -1 && at <= rank(target) ? null : target;
  };
}

const OFF = ['false', 'true'];
const ON = ['true', 'false'];
const offRule = (key: string, fallback = 'true'): Rule => ({ key, lower: cheapest(OFF, 'false', fallback) });
const onRule = (key: string, fallback = 'true'): Rule => ({ key, lower: cheapest(ON, 'true', fallback) });

export const OPTIONS_RULES: Rule[] = [
  { key: 'renderDistance', lower: atMost('6', 12) },
  { key: 'simulationDistance', lower: atMost('5', 12) },
  { key: 'graphicsMode', lower: atMost('0', 1) },
  offRule('ao'),
  { key: 'particles', lower: atLeast('2', 0) },
  { key: 'renderClouds', lower: cheapest(['"false"', '"fast"', '"true"'], '"false"', '"true"') },
  offRule('entityShadows'),
  { key: 'biomeBlendRadius', lower: atMost('0', 2) },
  { key: 'mipmapLevels', lower: atMost('0', 4) },
  { key: 'entityDistanceScaling', lower: atMost('0.75', 1) },
  { key: 'menuBackgroundBlurriness', lower: atMost('0', 5) },
];

export const IRIS_RULES: Rule[] = [offRule('enableShaders')];

const QUALITY = ['"FAST"', '"DEFAULT"', '"FANCY"'];

export const SODIUM_RULES: Rule[] = [
  { key: 'quality.leaves_quality', lower: cheapest(QUALITY, '"FAST"', '"DEFAULT"') },
  { key: 'quality.weather_quality', lower: cheapest(QUALITY, '"FAST"', '"DEFAULT"') },
  offRule('quality.enable_vignette'),
  onRule('performance.use_entity_culling'),
  onRule('performance.use_fog_occlusion'),
  onRule('performance.use_block_face_culling'),
  onRule('performance.animate_only_visible_textures'),
];

export function emptyBackup(): FileBackup {
  return { before: {}, applied: {} };
}

export function applyRules(doc: SettingsDoc, rules: Rule[], backup: FileBackup): string[] {
  const written: string[] = [];
  for (const rule of rules) {
    const current = doc.get(rule.key);
    const next = rule.lower(current);
    if (next === null || next === current) continue;
    if (!Object.prototype.hasOwnProperty.call(backup.before, rule.key)) {
      backup.before[rule.key] = current ?? null;
    }
    backup.applied[rule.key] = next;
    doc.set(rule.key, next);
    written.push(rule.key);
  }
  return written;
}

export function restoreRules(doc: SettingsDoc, backup: FileBackup): string[] {
  const restored: string[] = [];
  for (const [key, before] of Object.entries(backup.before)) {
    const applied = backup.applied[key];
    if (applied === undefined || doc.get(key) !== applied) continue;
    if (before === null) doc.delete(key);
    else doc.set(key, before);
    restored.push(key);
  }
  return restored;
}

export function keyValueDoc(text: string, separator: ':' | '='): SettingsDoc {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  const find = (key: string): number =>
    lines.findIndex((line) => {
      const at = line.indexOf(separator);
      return at > 0 && !line.startsWith('#') && line.slice(0, at).trim() === key;
    });
  return {
    get(key) {
      const at = find(key);
      return at === -1 ? undefined : lines[at].slice(lines[at].indexOf(separator) + 1);
    },
    set(key, value) {
      const at = find(key);
      if (at === -1) lines.push(`${key}${separator}${value}`);
      else lines[at] = `${key}${separator}${value}`;
    },
    delete(key) {
      const at = find(key);
      if (at !== -1) lines.splice(at, 1);
    },
    serialize() {
      return lines.join(newline) + (endsWithNewline || lines.length > 0 ? newline : '');
    },
  };
}

export function jsonDoc(text: string): SettingsDoc {
  const root = JSON.parse(text) as unknown;
  if (!isObject(root)) throw new Error('JSON object expected');
  const parent = (key: string, create: boolean): { node: Record<string, unknown>; leaf: string } | null => {
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node[part];
      if (!isObject(next)) {
        if (!create) return null;
        next = {};
        node[part] = next;
      }
      node = next as Record<string, unknown>;
    }
    return { node, leaf: parts[parts.length - 1] };
  };
  return {
    get(key) {
      const at = parent(key, false);
      if (!at || !Object.prototype.hasOwnProperty.call(at.node, at.leaf)) return undefined;
      return JSON.stringify(at.node[at.leaf]);
    },
    set(key, value) {
      const at = parent(key, true)!;
      at.node[at.leaf] = JSON.parse(value) as unknown;
    },
    delete(key) {
      const at = parent(key, false);
      if (at) delete at.node[at.leaf];
    },
    serialize() {
      return JSON.stringify(root, null, 2);
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const LOW_RAM_MB = 8704;
export const PACK_MIN_MEMORY_MB = 4096;
const FEW_THREADS = 4;
const INTEL = 0x8086;
const DISCRETE_VENDORS = new Set([0x10de, 0x1002, 0x1022]);

export interface GpuDevice {
  vendorId: number;
  deviceId?: number;
}

export interface HardwareFacts {
  totalMemMb: number;
  cpuCount: number;
  gpus: GpuDevice[];
}

export function lowEndReasons({ totalMemMb, cpuCount, gpus }: HardwareFacts): string[] {
  const reasons: string[] = [];
  if (totalMemMb > 0 && totalMemMb <= LOW_RAM_MB) reasons.push(`${Math.round(totalMemMb / 1024)} Go de RAM`);
  const real = gpus.filter((gpu) => gpu.vendorId === INTEL || DISCRETE_VENDORS.has(gpu.vendorId));
  if (real.length > 0 && real.every((gpu) => gpu.vendorId === INTEL)) reasons.push('carte graphique intégrée');
  if (cpuCount > 0 && cpuCount <= FEW_THREADS) reasons.push(`${cpuCount} threads`);
  return reasons;
}

export function potatoMemoryCapMb(totalMemMb: number): number | null {
  if (!(totalMemMb > 0) || totalMemMb > LOW_RAM_MB) return null;
  if (totalMemMb <= 4608) return 2048;
  return PACK_MIN_MEMORY_MB;
}

export function potatoMemoryMb(totalMemMb: number, configuredMb: number): number {
  const cap = potatoMemoryCapMb(totalMemMb);
  return cap === null ? configuredMb : Math.min(configuredMb, cap);
}

const GC_FLAG = /-XX:[+]Use\w*GC\b/;

export function potatoJvmArgs(userArgs: string): string[] {
  if (GC_FLAG.test(userArgs)) return [];
  return ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', '-XX:+UseStringDeduplication'];
}
