import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';

const INCLUDE_EXTS = new Set(['.exe', '.dmg', '.zip', '.AppImage', '.yml', '.blockmap']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hash(file, algo) {
  return createHash(algo).update(readFileSync(file)).digest('hex');
}

function formatSize(bytes) {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(2) + ' MB';
  if (bytes >= 1024)      return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

if (!process.argv[2]) fail('usage: node scripts/checksums.mjs <dossier des artefacts>');
const distDir = resolve(process.argv[2]);
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) fail(`Dossier introuvable : ${distDir}`);

const files = readdirSync(distDir)
  .filter(name => INCLUDE_EXTS.has(extname(name)) && statSync(join(distDir, name)).isFile())
  .sort();

if (files.length === 0) fail(`Aucun artefact trouvé dans ${distDir}`);

const lines = [
  `Karamon Launcher checksums`,
  `Générés le : ${new Date().toISOString()}`,
  '',
];

for (const name of files) {
  const full  = join(distDir, name);
  const size  = statSync(full).size;
  const sha256 = hash(full, 'sha256');
  const sha512 = hash(full, 'sha512');

  lines.push(`── ${name} (${formatSize(size)})`);
  lines.push(`   SHA256 : ${sha256}`);
  lines.push(`   SHA512 : ${sha512}`);
  lines.push('');
}

const out = join(distDir, 'checksums.txt');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`✓ checksums.txt généré (${files.length} fichier(s))`);
files.forEach(name => console.log(`  · ${name}`));
