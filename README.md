<div align="center">
  <img src="assets/banner.png" alt="Karamon" width="420" />
  <br/><br/>
  <p>Launcher et pack client pour le serveur <strong>karamon.fr</strong></p>

  ![Version](https://img.shields.io/github/v/release/vskstudio/Karamon-launcher?filter=launcher-v*&label=launcher&style=flat-square)
  ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=flat-square)
  ![Fabric](https://img.shields.io/badge/Fabric-0.18.4-orange?style=flat-square)
  ![Pack](https://img.shields.io/badge/pack-Cobbleverse%201.7.42-purple?style=flat-square)
</div>

---

Repo public du launcher. Le pack client (mods, resource packs, shaders, configs) est construit et publié par la CI de [`vskstudio/Karamon`](https://github.com/vskstudio/Karamon) sur `https://karamon.fr/downloads/`.

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

### Intégrité et réparation

Un plantage du PC pendant une écriture peut laisser un fichier de la bonne taille mais rempli d'octets nuls. Le launcher s'en protège (`src/main/features/integrity/`) :

- **Vérification par empreinte** : quand les manifestes du pack (`mods-manifest.json`, `resourcepacks-manifest.json`, `shaderpacks-manifest.json`, `overrides-manifest.json`) donnent un `sha1`, un fichier n'est à jour que si sa taille et son SHA-1 correspondent. Les empreintes sont mises en cache dans `.karamon-integrity-cache.json` (taille + date) pour ne recalculer que ce qui a bougé. Chaque `.jar`/`.zip` est aussi contrôlé par sa fin d'archive, même sans `sha1`. Seuls les fichiers abîmés sont réécrits.
- **Écritures sûres** : les fichiers du pack passent par un fichier temporaire vidé sur disque puis renommé (`src/main/shared/AtomicWrite.ts`).
- **Configs vides** : avant chaque lancement, les fichiers de `config/`, `defaultoptions.journal.json` et `resourcepacks/*.rpo` entièrement nuls sont déplacés dans `config-corrompues-AAAA-MM-JJ/`, puis remplacés par la version du pack (archive des overrides gardée dans `.karamon-overrides.zip`) ou laissés absents pour que le mod régénère sa valeur par défaut.
- **Réparer l'installation** (Paramètres → Maintenance) : revérifie chaque fichier sans le cache, réinstalle ceux qui sont abîmés et répare les configs.
- **Après un plantage au démarrage** (sortie en erreur dans les 2 premières minutes) : si le rapport de crash ou `logs/latest.log` montrent une corruption (`zip END header not found`, `ZipException`, `Error analyzing [`, `\u0000` dans une erreur JSON), la réparation se lance seule et le launcher propose de relancer.

## Releases

| Tag | Rôle |
|---|---|
| `launcher-vX.Y.Z` | Installeur Windows / macOS / Linux. Publié en pré-release, puis marqué **Latest** à la main pour l'auto-update. |
| `pack-vX.Y.Z` | Historique de l'ancien circuit du pack (jusqu'à 0.5.86). Plus alimenté. |

Le tag `pack-latest`, lu par les launchers jusqu'à 2.0.10, n'existe plus. Depuis 2.0.11, le pack vient uniquement de `https://karamon.fr/downloads/`.

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

Publier le launcher: tout push sur `main` qui touche au launcher (`src/`, `assets/`, `package.json`...) publie automatiquement la version patch suivante **en pré-release**. Les launchers installés ne la voient pas: electron-updater ne lit que la release marquée Latest. Une fois la pré-release testée et validée, la passer en Latest:

```bash
gh release edit launcher-vX.Y.Z --repo vskstudio/Karamon-launcher --prerelease=false --latest
```

Les launchers installés la récupèrent alors (vérif toutes les 30 min, installée à la fermeture sur Windows et Linux, annoncée avec un lien vers le `.dmg` sur macOS). Avant de publier, la release vérifie que chaque `url:` et `path:` des `latest*.yml` désigne un fichier publié et qu'aucun nom de fichier ne contient d'espace. Pour forcer une version précise, pousser un tag:

```bash
git tag launcher-v2.1.0
git push origin launcher-v2.1.0
```

Publier le pack: rien à faire dans ce repo. Tout push sur `main` de `vskstudio/Karamon` qui touche `content/` ou `mod/` lance le workflow « Publish pack », qui construit le pack et le dépose sur `https://karamon.fr/downloads/` (`pack.json` + manifestes). Le launcher le récupère au prochain clic sur « Mettre à jour les mods ». `scripts/publish-pack.sh` (publication en release GitHub) appartient à l'ancien circuit et ne sert plus.

Attention: un push sur `main` qui touche `src/` (tests compris) ou `scripts/` publie une release du launcher. `content/` et les `.md` n'en déclenchent pas.

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
