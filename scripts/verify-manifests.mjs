import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const MANIFEST_NAME = /^latest.*\.yml$/;
const REFERENCED_FILE = /^\s*(?:-\s*)?(?:url|path):\s*['"]?(.+?)['"]?\s*$/;

export function referencedFiles(manifest) {
  return manifest
    .split(/\r?\n/)
    .map(line => REFERENCED_FILE.exec(line)?.[1])
    .filter(name => name !== undefined);
}

export function manifestProblems(dir) {
  const names = readdirSync(dir).filter(name => statSync(join(dir, name)).isFile());
  const published = new Set(names);
  const problems = names
    .filter(name => /\s/.test(name))
    .map(name => `« ${name} » contient un espace, GitHub le renommerait.`);

  const manifests = names.filter(name => MANIFEST_NAME.test(name));
  if (manifests.length === 0) problems.push(`Aucun manifeste latest*.yml dans ${dir}.`);

  for (const manifest of manifests) {
    for (const file of referencedFiles(readFileSync(join(dir, manifest), 'utf8'))) {
      if (/\s/.test(file)) problems.push(`${manifest} référence « ${file} », qui contient un espace.`);
      else if (!published.has(file)) problems.push(`${manifest} référence « ${file} », absent des artefacts.`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error('usage: node scripts/verify-manifests.mjs <dossier des artefacts>');
    process.exit(1);
  }
  const problems = manifestProblems(resolve(dir));
  if (problems.length > 0) {
    problems.forEach(problem => console.error(`✗ ${problem}`));
    process.exit(1);
  }
  console.log('✓ Les manifestes pointent vers des fichiers publiés.');
}
