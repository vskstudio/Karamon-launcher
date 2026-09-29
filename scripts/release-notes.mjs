const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const notes = [
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
];

process.stdout.write(notes.join('\n') + '\n');
