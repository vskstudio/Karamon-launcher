<p align="center">
  <img src="docs/readme/banner.jpg" alt="Karamon" width="100%" />
</p>

<p align="center">
  Le launcher officiel de <a href="https://karamon.fr">Karamon</a>, serveur Minecraft Cobblemon francophone.
</p>

<p align="center">
  <a href="https://github.com/vskstudio/Karamon-launcher/releases/latest"><img src="https://img.shields.io/github/v/release/vskstudio/Karamon-launcher?filter=launcher-v*&label=version&style=flat-square&color=c8304a" alt="Version" /></a>
  <img src="https://img.shields.io/badge/Minecraft-1.21.1-7a5af8?style=flat-square" alt="Minecraft 1.21.1" />
  <img src="https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-555?style=flat-square" alt="Windows, macOS, Linux" />
</p>

---

Le launcher installe Minecraft, Fabric, Java et tous les mods du serveur, puis te connecte à `play.karamon.fr`. Tu n'as rien à configurer : tu te connectes avec ton compte Microsoft et tu cliques sur Jouer.

## Installer

Télécharge la dernière version sur la page [Releases](https://github.com/vskstudio/Karamon-launcher/releases/latest).

| Système | Fichier |
|---|---|
| Windows | `Karamon-Launcher-Setup-x.y.z.exe` |
| macOS (Apple Silicon) | `Karamon-Launcher-x.y.z-arm64.dmg` |
| macOS (Intel) | `Karamon-Launcher-x.y.z-x64.dmg` |
| Linux | `Karamon-Launcher-x.y.z.AppImage` |

Le launcher n'est pas encore signé, donc ton système va te prévenir au premier lancement.

- Sur Windows, SmartScreen affiche « Windows a protégé votre ordinateur ». Clique sur « Informations complémentaires », puis « Exécuter quand même ».
- Sur macOS, fais un clic droit sur l'application, puis « Ouvrir ».
- Sur Linux, rends le fichier exécutable (`chmod +x Karamon-Launcher-*.AppImage`) avant de l'ouvrir.

Chaque release contient un fichier `checksums.txt` si tu veux vérifier ce que tu as téléchargé.

## Premier lancement

1. Ouvre Karamon Launcher et connecte-toi avec ton compte Microsoft (celui de Minecraft Java).
2. Laisse le launcher préparer le jeu. La première fois, il télécharge environ 650 Mo de mods et de ressources, et installe Java 21 s'il ne le trouve pas.
3. Clique sur Jouer.

Les fois suivantes, il ne télécharge que ce qui a changé depuis ta dernière partie. Une mise à jour du pack pèse en général quelques dizaines de Mo.

## Ce que fait le launcher

Le pack reste aligné sur le serveur. Mods, resource packs, shaders et réglages arrivent tout seuls, et les mods en trop sont retirés pour que tu ne te fasses pas refuser à la connexion.

Tes réglages sont gardés. Si tu changes de shader, le coupes ou modifies ses options, ton choix reste en place après chaque mise à jour. Les shaders et resource packs que tu ajoutes toi-même ne sont pas supprimés.

Un PC qui s'éteint pendant un téléchargement peut laisser un mod ou une config vide. Le launcher le détecte, remplace le fichier et, si le jeu a planté au démarrage pour cette raison, te propose de relancer. Tu peux aussi tout revérifier avec « Réparer l'installation », dans la partie Maintenance des paramètres.

Le launcher se met à jour lui-même. Sur Windows et Linux, la nouvelle version s'installe quand tu le fermes. Sur macOS, il t'indique qu'une version est disponible et ouvre la page de téléchargement.

Tu y trouveras aussi la liste des mods installés, tes captures d'écran, les sauvegardes de tes mondes et les rapports de crash.

## Un problème ?

Commence par « Réparer l'installation » dans les paramètres. Si ça ne suffit pas, ouvre une [issue](https://github.com/vskstudio/Karamon-launcher/issues) en décrivant ce qui se passe et joins le fichier `logs/launcher.log`, qui se trouve dans le dossier du launcher :

- Windows : `%APPDATA%\.karamon-launcher`
- macOS : `~/Library/Application Support/.karamon-launcher`
- Linux : `~/.config/.karamon-launcher`

Ce journal ne contient pas tes jetons de connexion, ils sont masqués.

## Développement

Le launcher est une application Electron écrite en TypeScript. Il te faut Node.js 22.19 ou plus récent.

```bash
git clone https://github.com/vskstudio/Karamon-launcher.git
cd Karamon-launcher
npm install
npm run dev
```

| Commande | Rôle |
|---|---|
| `npm run typecheck` | Vérifie les types |
| `npm test` | Lance les tests |
| `npm run build:dist` | Installeur Windows |
| `npm run build:dist:mac` | `.dmg` macOS |
| `npm run build:dist:linux` | AppImage Linux |

Le code de l'application est dans `src/main` (processus principal : comptes, synchronisation du pack, lancement du jeu) et `src/renderer` (interface). Le dossier `content/` contient une copie du manifeste du pack, utilisée par défaut quand le serveur de téléchargement ne répond pas.

Les contributions sont bienvenues. Ouvre une issue avant un gros changement pour qu'on en parle. Une fois fusionné sur `main`, un changement du code est publié automatiquement à tous les joueurs, donc chaque pull request doit passer le typecheck, les tests et le build.

---

<p align="center">
  <img src="docs/readme/icon.png" alt="" width="48" /><br/>
  <sub><a href="https://karamon.fr">karamon.fr</a>. Karamon n'est affilié ni à Mojang, ni à Microsoft, ni à The Pokémon Company.</sub>
</p>
