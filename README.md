<div align="center">
  <img src="assets/banner.png" alt="Karamon" width="420" />
  <br/><br/>
  <p>Launcher et pack client pour le serveur <strong>karamon.fr</strong></p>

  ![Version](https://img.shields.io/badge/version-2.0.10-blue?style=flat-square)
  ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=flat-square)
  ![Fabric](https://img.shields.io/badge/Fabric-0.18.4-orange?style=flat-square)
  ![Pack](https://img.shields.io/badge/pack-Cobbleverse%201.7.42-purple?style=flat-square)
</div>

---

Repo public unique: installeur du launcher **et** le pack client (`mods.zip` + `assets.zip`).

## Téléchargement

Dernier installeur: [Releases](https://github.com/vskstudio/Karamon-launcher/releases) (tags `launcher-v*`).

```
Karamon Launcher Setup x.x.x.exe
```

macOS: `.dmg` arm64 (Apple Silicon) ou x64 (Intel). App non signée: clic droit, Ouvrir.

Le checksum `checksums.txt` est joint à chaque release launcher.

## Utilisation

1. Lance **Karamon Launcher**
2. Connecte-toi avec Microsoft
3. Clique sur **Mettre à jour les mods**
4. Clique sur **JOUER**

Java 21 est détecté ou installé automatiquement. Le pack se synchronise depuis le tag `pack-latest` de ce repo.

## Releases

| Tag | Rôle |
|---|---|
| `launcher-vX.Y.Z` | Installeur Windows / macOS. Marqué **Latest** pour l'auto-update. |
| `pack-vX.Y.Z` | Historique du pack client. |
| `pack-latest` | Alias du pack courant. Le launcher télécharge ici (`mods.zip` + `assets.zip`). |

`/releases/latest` reste le launcher. Le pack n'utilise pas ce raccourci, pour ne pas casser l'updater.

## Développement

Prérequis: [Node.js](https://nodejs.org) 18+

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
```

Publier le launcher:

```bash
git tag launcher-v2.0.10
git push origin launcher-v2.0.10
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
| Mods sync | GitHub Releases `pack-latest` + adm-zip |
| Auto-updater | electron-updater (ce repo) |
| Build | electron-builder |

<div align="center">
  <sub>Karamon — karamon.fr</sub>
</div>
