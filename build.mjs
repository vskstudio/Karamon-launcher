#!/usr/bin/env node
import { build, context } from 'esbuild';
import { copyFile, mkdir, rm } from 'fs/promises';
import path from 'path';

const watch = process.argv.includes('--watch');
const outDir = 'dist';

const targets = [
  {
    name: 'main',
    options: {
      entryPoints: ['src/main/main.ts'],
      outfile: `${outDir}/main.cjs`,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron', 'adm-zip'],
    },
  },
  {
    name: 'preload',
    options: {
      entryPoints: ['src/preload/preload.ts'],
      outfile: `${outDir}/preload.cjs`,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
    },
  },
  {
    name: 'renderer',
    options: {
      entryPoints: ['src/renderer/index.ts'],
      outfile: `${outDir}/renderer.js`,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
    },
  },
];

const commonOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  minify: !watch,
};

async function copyStatic() {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    copyFile('src/index.html', path.join(outDir, 'index.html')),
    copyFile('src/styles.css', path.join(outDir, 'styles.css')),
  ]);
  const packJson = path.resolve('content', 'pack.json');
  try {
    await copyFile(packJson, path.join(outDir, 'pack.json'));
  } catch {
    console.warn('build: content/pack.json introuvable, défauts Cobbleverse V2.');
  }
  const clientOptions = path.resolve('content', 'client-options.json');
  try {
    await copyFile(clientOptions, path.join(outDir, 'client-options.json'));
  } catch {
    console.warn('build: content/client-options.json introuvable, ordre resource packs non forcé.');
  }
}

async function clean() {
  await rm(outDir, { recursive: true, force: true });
}

async function buildAll() {
  await clean();
  await copyStatic();
  await Promise.all(
    targets.map((t) => build({ ...commonOptions, ...t.options })),
  );
  console.log('build: done.');
}

async function watchAll() {
  await clean();
  await copyStatic();
  const ctxs = await Promise.all(
    targets.map((t) => context({ ...commonOptions, ...t.options })),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('build: watching...');
}

if (watch) {
  await watchAll();
} else {
  await buildAll();
}
