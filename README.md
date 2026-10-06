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

### Mise à jour du pack : seulement ce qui a changé

Le launcher lit `mods.zip` et `assets.zip` directement sur `karamon.fr/downloads/` par requêtes `Range` (`src/main/shared/RemoteZip.ts`) : la fin de chaque archive (environ 64 Ko) donne la liste des fichiers avec leur taille et leur CRC-32. Il compare avec ce qui est installé (`FileVerifier.matchesZipEntry`, CRC mis en cache par taille + date) et ne télécharge que les fichiers différents ou manquants, directement à leur place (fichier temporaire, taille et CRC vérifiés, puis renommé). Chaque requête porte `If-Range` avec l'ETag lu au départ : si le pack est republié pendant la mise à jour, le launcher s'arrête au lieu de mélanger deux versions.

Mesuré sur le pack de prod (0.8.68) : mise à jour réelle du pack 78 Mo au lieu de 686 Mo, mod abîmé réparé avec 0,5 Mo, pack à jour 0 octet. Si le serveur refuse les plages ou si une lecture échoue, le launcher retombe sur le téléchargement complet des deux archives.

### Shaders : le choix du joueur est gardé

`src/main/features/minecraft/ShaderChoice.ts`, état dans `.karamon-shader-state.json` de l'instance.

- Le shader du pack (`shaderPack`, `enableShaders` de `client-options.json`) n'est sélectionné dans Iris que si aucun shader n'est choisi (première installation). Un shader choisi absent de `shaderpacks/` est gardé : EuphoriaPatcher crée ses packs au lancement du jeu.
- Un fichier de réglages livré par le pack (`shaderpacks/*.txt`) n'est remplacé que s'il manque, ou si le joueur ne l'a jamais modifié (il contient encore la version précédente du pack). Les fichiers que le pack ne livre pas ne sont jamais touchés ni supprimés.
- Pour imposer le shader lors d'une MAJ, le pack augmente `"shaderRevision"` dans `client-options.json` (absent = 0) : le launcher réapplique alors une fois le shader et les réglages du pack, puis le joueur est de nouveau libre. Champ convenu avec `vskstudio/Karamon`.
- L'ordre des resource packs, lui, est toujours réimposé (règle `.cursor/rules/resource-pack-order.mdc`).

### Journal et activité en jeu

- **Journal du launcher** : `logs/launcher.log` dans le dossier de données du launcher (`%APPDATA%\.karamon-launcher`, `~/Library/Application Support/.karamon-launcher`, `~/.config/.karamon-launcher` ; bouton « dossier de données » dans les paramètres). Il contient les messages d'état, les erreurs de mise à jour, les exceptions non gérées et les plantages de la fenêtre. Une copie tournée (`launcher.old.log`), 1 Mo chacune au plus ; les jetons sont masqués. C'est le fichier à demander à un joueur qui signale un bug.
- **Pendant que Minecraft tourne**, le launcher ne vérifie plus les mises à jour, ne pingue plus le serveur (ni pour l'accueil, ni pour Discord) et reprend à la fermeture du jeu. Le ping de l'accueil s'arrête aussi quand la fenêtre est réduite.

## Releases

| Tag | Rôle |
|---|---|
| `launcher-vX.Y.Z` | Installeur Windows / macOS / Linux. Marqué **Latest** pour l'auto-update. |
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

Publier le launcher: il suffit de pousser sur `main`. Tout push qui touche au launcher (`src/`, `assets/`, `package.json`...) publie automatiquement la version patch suivante, et les launchers installés la récupèrent (vérif toutes les 30 min, installée à la fermeture sur Windows et Linux, annoncée avec un lien vers le `.dmg` sur macOS). Avant de publier, la release vérifie que chaque `url:` et `path:` des `latest*.yml` désigne un fichier publié et qu'aucun nom de fichier ne contient d'espace. Pour forcer une version précise, pousser un tag:

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
