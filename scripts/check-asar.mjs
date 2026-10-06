#!/usr/bin/env node
// Fails the build when an app.asar grows past the limit: a packaging glob that
// pulls build output or node_modules back into the app shows up here first.
import fs from 'fs';
import path from 'path';

const LIMIT_MB = Number(process.env.ASAR_LIMIT_MB || 20);
const root = process.argv[2] || 'dist';

function* findAsars(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* findAsars(full);
    else if (entry.name === 'app.asar') yield full;
  }
}

const asars = [...findAsars(root)];
if (asars.length === 0) {
  console.error(`check-asar: aucun app.asar sous ${root}`);
  process.exit(1);
}
let failed = false;
for (const file of asars) {
  const mb = fs.statSync(file).size / 1048576;
  const ok = mb <= LIMIT_MB;
  console.log(`${ok ? 'ok ' : 'TROP GROS'} ${mb.toFixed(1)} Mo  ${file}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error(`check-asar: app.asar dépasse ${LIMIT_MB} Mo, vérifier files: dans electron-builder.yml`);
  process.exit(1);
}
