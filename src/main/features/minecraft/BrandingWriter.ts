import fs from 'fs';
import path from 'path';
import type { GameInstance } from '../../shared/GameInstance.ts';
import { KARAMON } from '../../../shared/Karamon.ts';

const LUMYMON_WELCOME_VERSION = 3;

export interface BrandingOptions {
  minecraftVersion: string;
  resourcePacks?: string[];
}

function minecraftVersionTag(minecraftVersion: string): string {
  return `%#D3D3D3%[%#%%#00E64D%${minecraftVersion}%#%%#D3D3D3%]%#%`;
}

function karamonVersionLine(minecraftVersion: string): string {
  return `%#E0556C%**KARA%#%%#ECE8F3%MON**%#% ${minecraftVersionTag(minecraftVersion)}`;
}

const HIDDEN_ELEMENT_IDS = [
  '704201f8-ff60-4ad9-a501-abf8dbe179e9-1743328958871',
  '8602b07b-6762-4416-9b08-f84da7c1b285-1751567611005',
];

const SHOWN_ELEMENT_IDS = [
  '069855b2-1b02-4412-aba8-7123339d8afb-1746103697603',
];

function cobbleverseVersionLine(minecraftVersion: string): RegExp {
  const tag = minecraftVersionTag(minecraftVersion).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`%#FF5500%\\*\\*COBBLE%#%VERSE\\*\\* \\[[^\\]\\n]+\\]\\(click:open_changelogs\\) ${tag}`, 'g');
}

const TITLE_FITS: { id: string; height: number; y: number }[] = [
  { id: '8b2f987c-d9c8-4a38-a0db-0d79261ce265-1734823207699', height: 64, y: -86 },
  { id: '16118991-7a2c-430a-bb97-26dd39f90f78-1746104621713', height: 77, y: 8 },
  { id: 'bde11e74-ca8c-4e37-b183-faf2de2bc48a-1783541933564', height: 26, y: -245 },
];

function fancyReplacements(minecraftVersion: string): [string, string][] {
  return [
    ['[source:local]/config/fancymenu/assets/cobbleverse_title.png', '[source:local]/config/fancymenu/assets/karamon_title.png'],
    ['[source:local]/config/fancymenu/assets/latias_latios_background.png', '[source:local]/config/fancymenu/assets/karamon_background.png'],
    ['https://discord.lumy.fun', KARAMON.discordUrl],
    ['https://www.lumyverse.com/cobbleverse', KARAMON.websiteUrl],
    [`%#FF5500%**KARAMON 1.0.0**%#% ${minecraftVersionTag(minecraftVersion)}`, karamonVersionLine(minecraftVersion)],
    ['source = &eby &c&lLUMY&b&lVERSE', 'source = '],
    ['official %#FFAA00%**COBBLEVERSE**%#% modpack', 'official %#FFAA00%**KARAMON**%#% modpack'],
    ['official %#FFAA00%**KARAMON 1.0.0**%#% modpack', 'official %#FFAA00%**KARAMON**%#% modpack'],
  ];
}

function forEachLayoutBlock(
  text: string,
  id: string,
  mutate: (lines: string[], from: number, to: number) => void,
): string {
  const lines = text.split(/\r?\n/);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let inBlock = false;
  let depth = 0;
  let start = -1;
  let foundId = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^(element|vanilla_button) \{/.test(line)) {
      inBlock = true;
      start = i;
      depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      foundId = line.includes(`instance_identifier = ${id}`);
      continue;
    }
    if (!inBlock) continue;
    foundId = foundId || line.includes(`instance_identifier = ${id}`);
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
    if (depth <= 0) {
      if (foundId) mutate(lines, start, i);
      inBlock = false;
    }
  }
  return lines.join(nl);
}

function setHiddenFlag(lines: string[], from: number, to: number, hidden: boolean): void {
  const value = hidden ? 'true' : 'false';
  let hasHidden = false;
  for (let i = from; i <= to; i++) {
    if (/^\s*is_hidden\s*=/.test(lines[i])) {
      lines[i] = `  is_hidden = ${value}`;
      hasHidden = true;
    }
  }
  if (!hasHidden) {
    lines.splice(to, 0, `  is_hidden = ${value}`);
  }
}

function hideFancyElement(text: string, id: string): string {
  return forEachLayoutBlock(text, id, (lines, from, to) => {
    for (let i = from; i <= to; i++) {
      if (/^\s*stay_on_screen\s*=/.test(lines[i])) lines[i] = '  stay_on_screen = false';
      if (/^\s*navigatable\s*=/.test(lines[i])) lines[i] = '  navigatable = false';
      if (/^\s*base_opacity\s*=/.test(lines[i])) lines[i] = '  base_opacity = 0.0';
    }
    setHiddenFlag(lines, from, to, true);
  });
}

function showFancyElement(text: string, id: string): string {
  return forEachLayoutBlock(text, id, (lines, from, to) => {
    for (let i = from; i <= to; i++) {
      if (/^\s*stay_on_screen\s*=/.test(lines[i])) lines[i] = '  stay_on_screen = true';
      if (/^\s*navigatable\s*=/.test(lines[i])) lines[i] = '  navigatable = true';
      if (/^\s*base_opacity\s*=/.test(lines[i])) lines[i] = '  base_opacity = 1.0';
    }
    setHiddenFlag(lines, from, to, false);
  });
}

function fitFancyElement(text: string, id: string, height: number, y: number): string {
  return forEachLayoutBlock(text, id, (lines, from, to) => {
    for (let i = from; i <= to; i++) {
      if (/^\s*height\s*=/.test(lines[i])) lines[i] = `  height = ${height}`;
      if (/^\s*y\s*=/.test(lines[i])) lines[i] = `  y = ${y}`;
    }
  });
}

function setVanillaButtonHidden(text: string, id: string, hidden: boolean): string {
  return forEachLayoutBlock(text, id, (lines, from, to) => {
    setHiddenFlag(lines, from, to, hidden);
  });
}

function patchFancyMenu(text: string, minecraftVersion: string): string {
  let next = text.replace(cobbleverseVersionLine(minecraftVersion), karamonVersionLine(minecraftVersion));
  for (const [from, to] of fancyReplacements(minecraftVersion)) next = next.split(from).join(to);
  for (const id of HIDDEN_ELEMENT_IDS) next = hideFancyElement(next, id);
  for (const id of SHOWN_ELEMENT_IDS) next = showFancyElement(next, id);
  for (const fit of TITLE_FITS) next = fitFancyElement(next, fit.id, fit.height, fit.y);
  next = setVanillaButtonHidden(next, 'pause_report_bugs_button', true);
  return next;
}

const ICON_32 = '[source:local]/config/fancymenu/assets/karamon_icon_32.png';
const ICON_16 = '[source:local]/config/fancymenu/assets/karamon_icon_16.png';
const ICON_ICNS = '[source:local]/config/fancymenu/assets/karamon_icon_32.icns';

function setFancyOption(text: string, kind: 'B' | 'S', key: string, value: string): string {
  const line = `${kind}:${key} = '${value}';`;
  const re = new RegExp(`${kind}:${key} = '[^']*';`);
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function patchFancyOptions(text: string): string {
  let next = text;
  next = setFancyOption(next, 'B', 'show_custom_window_icon', 'true');
  next = setFancyOption(next, 'S', 'custom_window_title', 'KARAMON');
  next = setFancyOption(next, 'S', 'custom_window_icon_32', ICON_32);
  next = setFancyOption(next, 'S', 'custom_window_icon_16', ICON_16);
  next = setFancyOption(next, 'S', 'custom_window_icon_macos', ICON_ICNS);
  next = setFancyOption(next, 'B', 'show_customization_overlay', 'false');
  next = setFancyOption(next, 'B', 'modpack_mode', 'true');
  return next;
}

function skipLumyMonWelcome(raw: string): string {
  let data: Record<string, unknown> = {};
  const trimmed = raw.replace(/\u0000/g, '').trim();
  if (trimmed.length > 0) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = {};
    }
  }
  const current = Number(data.initialScreenVersion ?? 0);
  if (!Number.isFinite(current) || current < LUMYMON_WELCOME_VERSION) {
    data.initialScreenVersion = LUMYMON_WELCOME_VERSION;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

type PackOverride = {
  title?: string;
  description?: string;
  hidden?: boolean;
  force_compatible?: boolean;
};

function patchedPackOverrides(raw: string, defaultPacks?: string[]): string | null {
  try {
    return patchPackOverrides(raw, defaultPacks);
  } catch {
    return null;
  }
}

function patchPackOverrides(raw: string, defaultPacks?: string[]): string {
  const data = JSON.parse(raw) as {
    default_packs?: string[];
    pack_overrides?: Record<string, PackOverride>;
  };
  if (!data.pack_overrides) data.pack_overrides = {};
  const overrides = data.pack_overrides;

  const set = (file: string, title: string, description: string): void => {
    overrides[file] = { ...(overrides[file] ?? {}), title, description };
  };

  set('file/COBBLEVERSE RP [CF].zip', '"§e§lKaramon"', '"§a✔ Pack principal"');
  set(
    'file/COBBLEVERSE Soundtrack.zip',
    '"§e§lSoundtrack"',
    '"§a✔ Custom Background Music\n§f© Pokestir & Zame"',
  );
  set(
    'file/COBBLEVERSE RCTmod RP.zip',
    '"§e§lTrainer Skins"',
    '"§a✔ Animated Skins for Trainers"',
  );

  if (defaultPacks && defaultPacks.length > 0) {
    data.default_packs = defaultPacks;
  }

  return `${JSON.stringify(data, null, 2)}\n`;
}

function writeIfChanged(file: string, next: string): void {
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (previous === next) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
}

const XAERO_MINIMAP_HUD =
  'module;id=xaerominimap:minimap;x=0;y=0;centered=false;fromRight=true;fromBottom=false;flippedVer=false;flippedHor=false;\n';

const XAERO_MINIMAP_MODULE =
  'module;id=xaerominimap:minimap;active=true;x=0;y=0;centered=false;fromRight=true;fromBottom=false;flippedVer=false;flippedHor=false;';

function pinXaeroMinimapModule(raw: string): string {
  if (!/^module;id=xaerominimap:minimap;/m.test(raw)) return raw;
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const ended = raw.endsWith('\n') || raw.endsWith('\r\n');
  let next = raw.replace(/^module;id=xaerominimap:minimap;.*$/m, XAERO_MINIMAP_MODULE);
  if (ended && !next.endsWith('\n')) next += nl;
  return next;
}

function pinXaeroConfigs(configDir: string): void {
  const hudTargets = [
    path.join(configDir, 'xaerohud.txt'),
    path.join(configDir, 'defaultoptions', 'xaerohud.txt'),
    path.join(configDir, 'yosbr', 'config', 'xaerohud.txt'),
  ];
  for (const file of hudTargets) writeIfChanged(file, XAERO_MINIMAP_HUD);

  const miniTargets = [
    path.join(configDir, 'xaerominimap.txt'),
    path.join(configDir, 'yosbr', 'config', 'xaerominimap.txt'),
  ];
  for (const file of miniTargets) {
    if (!fs.existsSync(file)) continue;
    const previous = fs.readFileSync(file, 'utf8');
    writeIfChanged(file, pinXaeroMinimapModule(previous));
  }
}

function copyFancyAssetsFromUiPack(resourcePacksDir: string, configDir: string): void {
  const srcDir = path.join(resourcePacksDir, 'Karamon UI', 'assets', 'karamon', 'textures', 'gui');
  const destDir = path.join(configDir, 'fancymenu', 'assets');
  const copies: [string, string][] = [
    ['title.png', 'karamon_title.png'],
    ['background.png', 'karamon_background.png'],
    ['icon_16.png', 'karamon_icon_16.png'],
    ['icon_32.png', 'karamon_icon_32.png'],
    ['icon_32.icns', 'karamon_icon_32.icns'],
  ];
  for (const [fromName, toName] of copies) {
    const src = path.join(srcDir, fromName);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, toName));
  }
}

export function applyKaramonBranding(instance: GameInstance, { minecraftVersion, resourcePacks }: BrandingOptions): void {
  const { configDir } = instance;
  copyFancyAssetsFromUiPack(instance.resourcePacksDir, configDir);

  const fancyDir = path.join(configDir, 'fancymenu', 'customization');
  if (fs.existsSync(fancyDir)) {
    for (const name of fs.readdirSync(fancyDir)) {
      if (!name.endsWith('.txt')) continue;
      const file = path.join(fancyDir, name);
      const previous = fs.readFileSync(file, 'utf8');
      const next = patchFancyMenu(previous, minecraftVersion);
      if (next !== previous) fs.writeFileSync(file, next, 'utf8');
    }
  }

  const fancyRoot = path.join(configDir, 'fancymenu');
  const fancyOptions = path.join(fancyRoot, 'options.txt');
  if (fs.existsSync(fancyOptions)) {
    const previous = fs.readFileSync(fancyOptions, 'utf8');
    const next = patchFancyOptions(previous);
    if (next !== previous) fs.writeFileSync(fancyOptions, next, 'utf8');
  }

  const listeners = path.join(fancyRoot, 'listener_instances.txt');
  if (fs.existsSync(listeners)) {
    const previous = fs.readFileSync(listeners, 'utf8');
    const next = previous.split('https://www.lumyverse.com/wiki/changelog/').join(KARAMON.discordUrl);
    if (next !== previous) fs.writeFileSync(listeners, next, 'utf8');
  }

  const lumy = path.join(configDir, 'lumymon.json');
  const lumyRaw = fs.existsSync(lumy) ? fs.readFileSync(lumy, 'utf8') : '';
  writeIfChanged(lumy, skipLumyMonWelcome(lumyRaw));

  const overrides = path.join(configDir, 'resourcepackoverrides.json');
  if (fs.existsSync(overrides)) {
    const previous = fs.readFileSync(overrides, 'utf8');
    const patched = patchedPackOverrides(previous, resourcePacks);
    if (patched !== null) writeIfChanged(overrides, patched);
  }

  pinXaeroConfigs(configDir);
}
