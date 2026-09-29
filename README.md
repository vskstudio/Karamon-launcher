<div align="center">
  <img src="assets/banner.png" alt="Karamon" width="420" />
  <br/><br/>
  <p>Launcher et pack client pour le serveur <strong>karamon.fr</strong></p>

  ![Version](https://img.shields.io/badge/version-2.0.11-blue?style=flat-square)
  ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=flat-square)
  ![Fabric](https://img.shields.io/badge/Fabric-0.18.4-orange?style=flat-square)
  ![Pack](https://img.shields.io/badge/pack-Cobbleverse%201.7.42-purple?style=flat-square)
</div>

---

Repo public unique: installeur du launcher **et** le pack client (`mods.zip` + `assets.zip`).

## Téléchargement

Dernier installeur: [Releases](https://github.com/vskstudio/Karamon-launcher/releases) (tags `launcher-v*`).

```
Karamon-Launcher-Setup-x.x.x.exe
```

macOS: `.dmg` arm64 (Apple Silicon) ou x64 (Intel). App non signée: clic droit, Ouvrir. electron-updater n'installe une mise à jour macOS que sur une app signée, donc la release ne publie pas de `.zip` et `latest-mac.yml` ne liste que les `.dmg`. Le launcher macOS y lit seulement la dernière version: il l'annonce et son bouton « Télécharger » ouvre la dernière release, où le joueur reprend le `.dmg`.

Linux: `Karamon-Launcher-x.x.x.AppImage` (x64), à rendre exécutable avec `chmod +x`.

Le job de release calcule un seul `checksums.txt` (SHA256 et SHA512 des installeurs Windows, macOS et Linux et de leurs fichiers d'auto-update) et le joint à chaque release launcher.

## Utilisation

1. Lance **Karamon Launcher**
2. Connecte-toi avec Microsoft
3. Clique sur **Mettre à jour les mods**
4. Clique sur **JOUER**

Java 21 est détecté ou, s'il manque, installé automatiquement sur Windows, macOS et Linux. Le pack se synchronise depuis `https://karamon.fr/downloads/`.

## Releases

| Tag | Rôle |
|---|---|
| `launcher-vX.Y.Z` | Installeur Windows / macOS / Linux. Marqué **Latest** pour l'auto-update. |
| `pack-vX.Y.Z` | Historique du pack client. |
| `pack-latest` | Alias du pack courant, lu par les launchers jusqu'à 2.0.10. À partir de 2.0.11, le pack vient de `https://karamon.fr/downloads/`. |

`/releases/latest` reste le launcher. Le pack n'utilise pas ce raccourci, pour ne pas casser l'updater.

## Développement

Prérequis: [Node.js](https://nodejs.org) 22.19+

```bash
git clone https://github.com/vskstudio/Karamon-launcher.git
cd Karamon-launcher
npm install
npm start
```

### Build installeur

```bash
npm run build:dist        # Windows
npm run build:dist:mac    # macOS
npm run build:dist:linux  # Linux (AppImage)
```

Publier le launcher: il suffit de pousser sur `main`. Tout push qui touche au launcher (`src/`, `assets/`, `package.json`...) publie automatiquement la version patch suivante, et les launchers installés la récupèrent (vérif toutes les 30 min, installée à la fermeture sur Windows et Linux, annoncée avec un lien vers le `.dmg` sur macOS). Avant de publier, la release vérifie que chaque `url:` et `path:` des `latest*.yml` désigne un fichier publié et qu'aucun nom de fichier ne contient d'espace. Pour forcer une version précise, pousser un tag:

```bash
git tag launcher-v2.1.0
git push origin launcher-v2.1.0
```

Publier le pack (après `node scripts/build-content-pack.mjs` côté serveur KaramonV2):

```bash
./scripts/publish-pack.sh 0.5.2 path/to/mods.zip path/to/other-assets...
```

Détail du pack: `content/README.md`.

## Stack

| Composant | Technologie |
|---|---|
| Shell | Electron |
| Mods sync | `karamon.fr/downloads/` + adm-zip |
| Auto-updater | electron-updater (ce repo) |
| Build | electron-builder |

<div align="center">
  <sub>Karamon, karamon.fr</sub>
</div>
