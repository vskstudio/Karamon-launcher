import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  hideFancyElement,
  patchFancyMenu,
  patchFancyOptions,
  patchPackOverrides,
  skipLumyMonWelcome,
  applyKaramonBranding,
  LUMYMON_WELCOME_VERSION,
  KARAMON_DISCORD,
  KARAMON_WIKI,
} from './BrandingWriter.ts';

test('patchFancyMenu swaps logo, discord, version and hides Apex', () => {
  const src = [
    'element {',
    '  source = [source:local]/config/fancymenu/assets/cobbleverse_title.png',
    '}',
    'element {',
    '  [executable_action_instance:x][action_type:openlink] = https://discord.lumy.fun',
    '  instance_identifier = other',
    '}',
    'element {',
    '  [executable_action_instance:e2398f67-ae55-4633-9533-94d39a09cf54-1743331354465][action_type:openlink] = https://apexhost.gg/LUMYVERSE',
    '  label = Start a Server',
    '  navigatable = true',
    '  instance_identifier = 704201f8-ff60-4ad9-a501-abf8dbe179e9-1743328958871',
    '  stay_on_screen = true',
    '  base_opacity = 1.0',
    '}',
    'element {',
    '  source = %#FF5500%**COBBLE%#%VERSE** [1.7.42-CF](click:open_changelogs) %#D3D3D3%[%#%%#00E64D%1.21.1%#%%#D3D3D3%]%#%',
    '  source = &eby &c&lLUMY&b&lVERSE',
    '}',
  ].join('\n');
  const next = patchFancyMenu(src);
  assert.match(next, /karamon_title\.png/);
  assert.doesNotMatch(next, /cobbleverse_title\.png/);
  assert.match(next, new RegExp(KARAMON_DISCORD.replace(/\./g, '\\.')));
  assert.doesNotMatch(next, /discord\.lumy\.fun/);
  assert.doesNotMatch(next, /open_changelogs/);
  assert.doesNotMatch(next, /COBBLE%#%VERSE/);
  assert.doesNotMatch(next, /LUMY&b&lVERSE/);
  assert.match(next, /stay_on_screen = false/);
  assert.match(next, /navigatable = false/);
  assert.match(next, /is_hidden = true/);
});

test('patchFancyMenu rebrands the Modrinth title line without -CF suffix', () => {
  const src =
    'element {\n  source = %#FF5500%**COBBLE%#%VERSE** [1.7.42](click:open_changelogs) %#D3D3D3%[%#%%#00E64D%1.21.1%#%%#D3D3D3%]%#%\n}\n';
  const next = patchFancyMenu(src);
  assert.doesNotMatch(next, /COBBLE%#%VERSE/);
  assert.doesNotMatch(next, /open_changelogs/);
  assert.match(next, /KARA%#%%#ECE8F3%MON/);
});

test('patchFancyMenu gives the Karamon logo its own aspect ratio and background', () => {
  const src = [
    'menu_background {',
    '  image_path = [source:local]/config/fancymenu/assets/latias_latios_background.png',
    '}',
    'element {',
    '  element_type = image',
    '  instance_identifier = 8b2f987c-d9c8-4a38-a0db-0d79261ce265-1734823207699',
    '  auto_sizing_base_screen_height = 1443',
    '  x = -27',
    '  y = -61',
    '  width = 268',
    '  height = 39',
    '  animated_offset_y = 0',
    '  advanced_height = -2147483648',
    '  source = [source:local]/config/fancymenu/assets/cobbleverse_title.png',
    '}',
  ].join('\n');
  const next = patchFancyMenu(src);
  assert.match(next, /karamon_background\.png/);
  assert.doesNotMatch(next, /latias_latios_background/);
  assert.match(next, /\n  y = -86\n/);
  assert.match(next, /\n  width = 268\n  height = 64\n/);
  assert.match(next, /auto_sizing_base_screen_height = 1443/);
  assert.match(next, /animated_offset_y = 0/);
  assert.match(next, /advanced_height = -2147483648/);
  assert.equal(patchFancyMenu(next), next);
});

test('hideFancyElement only touches the matching block', () => {
  const src = [
    'element {',
    '  instance_identifier = keep-me',
    '  stay_on_screen = true',
    '  navigatable = true',
    '  base_opacity = 1.0',
    '}',
    'element {',
    '  instance_identifier = 069855b2-1b02-4412-aba8-7123339d8afb-1746103697603',
    '  stay_on_screen = true',
    '  navigatable = true',
    '  base_opacity = 1.0',
    '}',
  ].join('\n');
  const next = hideFancyElement(src, '069855b2-1b02-4412-aba8-7123339d8afb-1746103697603');
  assert.match(next, /instance_identifier = keep-me\n  stay_on_screen = true/);
  assert.match(next, /069855b2[\s\S]*stay_on_screen = false/);
  assert.match(next, /069855b2[\s\S]*is_hidden = true/);
});

test('patchFancyMenu keeps Wiki visible and retargets it off Lumyverse', () => {
  const src = [
    'vanilla_button {',
    '  instance_identifier = pause_report_bugs_button',
    '  is_hidden = false',
    '}',
    'element {',
    '  [executable_action_instance:x][action_type:openlink] = https://www.lumyverse.com/cobbleverse',
    '  label = WIKI',
    '  instance_identifier = 069855b2-1b02-4412-aba8-7123339d8afb-1746103697603',
    '  stay_on_screen = false',
    '  navigatable = false',
    '  base_opacity = 0.0',
    '  is_hidden = true',
    '}',
  ].join('\n');
  const next = patchFancyMenu(src);
  assert.match(next, /instance_identifier = pause_report_bugs_button\n  is_hidden = true/);
  assert.match(next, /069855b2[\s\S]*stay_on_screen = true/);
  assert.match(next, /069855b2[\s\S]*navigatable = true/);
  assert.match(next, /069855b2[\s\S]*is_hidden = false/);
  assert.match(next, new RegExp(KARAMON_WIKI.replace(/\./g, '\\.')));
  assert.doesNotMatch(next, /lumyverse\.com\/cobbleverse/);
});

test('skipLumyMonWelcome bumps version and keeps other keys', () => {
  const next = skipLumyMonWelcome('{\n  "remotePcEnabled": true,\n  "initialScreenVersion": 0\n}\n');
  const data = JSON.parse(next) as { remotePcEnabled: boolean; initialScreenVersion: number };
  assert.equal(data.remotePcEnabled, true);
  assert.equal(data.initialScreenVersion, LUMYMON_WELCOME_VERSION);
});

test('skipLumyMonWelcome recovers from empty or zeroed files', () => {
  const next = skipLumyMonWelcome('\u0000\u0000');
  const data = JSON.parse(next) as { initialScreenVersion: number };
  assert.equal(data.initialScreenVersion, LUMYMON_WELCOME_VERSION);
});

test('patchPackOverrides drops Cobbleverse pack titles', () => {
  const raw = JSON.stringify({
    pack_overrides: {
      'file/COBBLEVERSE RP [CF].zip': {
        title: '"§e§lCOBBLEVERSE"',
        description: '"§a✔ Main Resource Pack\\n§f© §cLUMY§bVERSE"',
      },
    },
  });
  const next = patchPackOverrides(raw);
  assert.match(next, /§e§lKaramon/);
  assert.doesNotMatch(next, /§e§lCOBBLEVERSE/);
  assert.doesNotMatch(next, /LUMY/);
});

test('patchFancyOptions sets KARAMON window title', () => {
  const next = patchFancyOptions(
    "B:show_custom_window_icon = 'false';\nS:custom_window_title = '';\nS:custom_window_icon_32 = '';\nS:custom_window_icon_16 = '';\nS:custom_window_icon_macos = '';\nB:show_customization_overlay = 'true';\nB:modpack_mode = 'false';\n",
  );
  assert.match(next, /B:show_custom_window_icon = 'true';/);
  assert.match(next, /S:custom_window_title = 'KARAMON';/);
  assert.match(next, /karamon_icon_32\.png/);
  assert.match(next, /karamon_icon_16\.png/);
  assert.match(next, /B:show_customization_overlay = 'false';/);
  assert.match(next, /B:modpack_mode = 'true';/);
});

test('patchFancyOptions appends overlay lock when keys are missing', () => {
  const next = patchFancyOptions("S:custom_window_title = 'COBBLEVERSE';\n");
  assert.match(next, /B:show_customization_overlay = 'false';/);
  assert.match(next, /B:modpack_mode = 'true';/);
});

test('applyKaramonBranding copies title assets from the Karamon UI pack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-assets-'));
  const src = path.join(dir, 'resourcepacks', 'Karamon UI', 'assets', 'karamon', 'textures', 'gui');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'title.png'), 'title');
  fs.writeFileSync(path.join(src, 'icon_16.png'), 'i16');
  fs.writeFileSync(path.join(src, 'icon_32.png'), 'i32');
  fs.writeFileSync(path.join(src, 'icon_32.icns'), 'icns');
  applyKaramonBranding(dir);
  const assets = path.join(dir, 'config', 'fancymenu', 'assets');
  assert.equal(fs.readFileSync(path.join(assets, 'karamon_title.png'), 'utf8'), 'title');
  assert.equal(fs.readFileSync(path.join(assets, 'karamon_icon_16.png'), 'utf8'), 'i16');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyKaramonBranding writes lumymon skip into a game dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-brand-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'lumymon.json'), '{"initialScreenVersion":0}\n', 'utf8');
  applyKaramonBranding(dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'config', 'lumymon.json'), 'utf8')) as {
    initialScreenVersion: number;
  };
  assert.equal(data.initialScreenVersion, LUMYMON_WELCOME_VERSION);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyKaramonBranding pins the Xaero minimap to the top-right', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-xaero-'));
  fs.mkdirSync(path.join(dir, 'config', 'yosbr', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config', 'xaerohud.txt'),
    'module;id=xaerominimap:minimap;x=0;y=0;centered=false;fromRight=false;fromBottom=false;flippedVer=false;flippedHor=false;\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'config', 'xaerominimap.txt'),
    'minimap:true\nmodule;id=xaerominimap:minimap;active=true;x=12;y=4;centered=false;fromRight=false;fromBottom=false;flippedVer=false;flippedHor=false;\n',
    'utf8',
  );
  applyKaramonBranding(dir);
  const hud = fs.readFileSync(path.join(dir, 'config', 'xaerohud.txt'), 'utf8');
  const defaults = fs.readFileSync(path.join(dir, 'config', 'defaultoptions', 'xaerohud.txt'), 'utf8');
  const yosbr = fs.readFileSync(path.join(dir, 'config', 'yosbr', 'config', 'xaerohud.txt'), 'utf8');
  const mini = fs.readFileSync(path.join(dir, 'config', 'xaerominimap.txt'), 'utf8');
  assert.match(hud, /fromRight=true/);
  assert.doesNotMatch(hud, /fromRight=false/);
  assert.equal(defaults, hud);
  assert.equal(yosbr, hud);
  assert.match(mini, /fromRight=true/);
  assert.doesNotMatch(mini, /fromRight=false/);
  assert.match(mini, /^minimap:true$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});
