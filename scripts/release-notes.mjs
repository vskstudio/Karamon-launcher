import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const MAX_CHANGES = 8;

export function changesSince(subjects) {
  return subjects
    .map((subject) => subject.trim())
    .filter((subject) => subject && !/^Merge (pull request|branch)\b/.test(subject))
    .slice(0, MAX_CHANGES);
}

export function releaseNotes(version, changes = []) {
  const notes = [];
  if (changes.length > 0) {
    notes.push('## Nouveautés', ...changes.map((change) => `- ${change}`), '');
  }
  notes.push(
    'Launcher officiel Karamon (Cobbleverse 1.7.42, Fabric 0.18.4, Minecraft 1.21.1).',
    '',
    '## Windows',
    `Installe \`Karamon-Launcher-Setup-${version}.exe\`, connecte-toi avec Microsoft, mets à jour les mods, puis JOUER.`,
    '',
    '## macOS',
    "Ouvre le `.dmg` (arm64 Apple Silicon, x64 Intel). L'app n'est pas signée : clic droit, Ouvrir.",
    '',
    '## Linux',
    `Télécharge \`Karamon-Launcher-${version}.AppImage\`, rends-le exécutable (\`chmod +x\`) puis lance-le.`,
    '',
    "Java 21 est détecté ou, s'il manque, installé automatiquement sur Windows, macOS et Linux. Le pack se synchronise depuis https://karamon.fr/downloads/.",
  );
  return notes.join('\n') + '\n';
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function commitSubjects(version) {
  const previous = git(['tag', '-l', 'launcher-v*', '--sort=-v:refname'])
    .split('\n')
    .find((tag) => tag && tag !== `launcher-v${version}`);
  if (!previous) return [];
  const log = git(['log', `${previous}..HEAD`, '--no-merges', '--format=%s']);
  return log ? log.split('\n') : [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(1);
  }
  process.stdout.write(releaseNotes(version, changesSince(commitSubjects(version))));
}
