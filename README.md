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

Le launcher installe Minecraft, Fabric, Java et tous les mods du serveur, puis te connecte à `play.karamon.fr`. Tu n'as rien à configurer : tu te connectes avec ton compte Microsoft, ou avec un simple pseudo si tu n'as pas de licence Minecraft, et tu cliques sur Jouer.

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

1. Ouvre Karamon Launcher et connecte-toi avec ton compte Microsoft (celui de Minecraft Java), ou choisis « Jouer sans compte Microsoft » (voir plus bas).
2. Laisse le launcher préparer le jeu. La première fois, il télécharge environ 650 Mo de mods et de ressources, et installe Java 21 s'il ne le trouve pas.
3. Clique sur Jouer.

Les fois suivantes, il ne télécharge que ce qui a changé depuis ta dernière partie. Une mise à jour du pack pèse en général quelques dizaines de Mo.

## Jouer sans compte Microsoft

Sans licence Minecraft, clique sur Jouer, puis « Jouer sans compte Microsoft », et choisis un pseudo de 3 à 16 caractères (lettres sans accent, chiffres et `_`). Un pseudo qui appartient déjà à un compte Minecraft officiel est refusé par le serveur : le launcher te prévient avant.

- Ton compte Karamon est protégé par un mot de passe : le jeu te le demande à chaque connexion au serveur (la première fois, tu le choisis).
- Ton skin vient d'Ely.by ou de TLauncher si ton pseudo y en a un. Sinon, choisis-le en jeu avec `/skin`.

Le launcher retient tes comptes. Clique sur ton pseudo en haut à droite pour passer d'un compte à l'autre ou te déconnecter.

## Ce que fait le launcher

Le pack reste aligné sur le serveur. Mods, resource packs, shaders et réglages arrivent tout seuls, et les mods en trop sont retirés pour que tu ne te fasses pas refuser à la connexion.

Tes réglages sont gardés. Si tu changes de shader, le coupes ou modifies ses options, ton choix reste en place après chaque mise à jour. Les shaders et resource packs que tu ajoutes toi-même ne sont pas supprimés.

Un PC qui s'éteint pendant un téléchargement peut laisser un mod ou une config vide. Le launcher le détecte, remplace le fichier et, si le jeu a planté au démarrage pour cette raison, te propose de relancer. Tu peux aussi tout revérifier avec « Réparer l'installation », dans la partie Maintenance des paramètres.

Le launcher se met à jour lui-même. Sur Windows et Linux, la nouvelle version s'installe quand tu le fermes. Sur macOS, il t'indique qu'une version est disponible et ouvre la page de téléchargement.

Tu y trouveras aussi la liste des mods installés, tes captures d'écran, les sauvegardes de tes mondes et les rapports de crash.

## Mode PC modeste

Pour les petites configs, active « Mode PC modeste » dans les paramètres. Le launcher te le propose une fois si ton PC a 8 Go de RAM ou moins, seulement une carte graphique Intel intégrée, ou 4 threads ou moins. Il ne l'active jamais tout seul.

Tant qu'il est actif, avant chaque lancement :

- les shaders sont coupés. Ton shader reste sélectionné, et tu peux les rallumer en jeu jusqu'au lancement suivant ;
- les graphismes sont baissés : distance de rendu 6 et simulation 5 (comme le serveur), mode rapide, sans occlusion ambiante, nuages, ombres d'entités ni flou des menus, particules minimales, pas de mélange des biomes ni de mipmaps, entités affichées moins loin, feuilles et météo rapides dans Sodium. Un réglage que tu as déjà mis plus bas n'est jamais remonté ;
- quatre mods qui ne servent qu'à l'image et au son, et que le serveur ne demande pas, sont désactivés : Voxy, Particular, Particle Rain et Sound Physics Remastered ;
- si ton PC a 8 Go de RAM ou moins, le jeu démarre avec 3 Go au plus (2 à 2,5 Go sur 4 à 6 Go de RAM), avec des réglages de mémoire légers si tu n'as pas choisi les tiens.

Quand tu le coupes, tes réglages d'avant et les mods reviennent. Un réglage que tu as changé toi-même pendant que le mode était actif reste comme tu l'as mis. Les mods désactivés restent vérifiés par « Réparer l'installation » : ils sont gardés en `.jar.disabled` et ne sont pas retéléchargés.

## Désactiver Sodium

Si le jeu plante ou reste bloqué au démarrage à cause de Sodium, coche « Désactiver Sodium » dans les paramètres. Sodium est désactivé avec les mods qui en ont besoin pour démarrer : Iris (plus de shaders), Voxy (plus de terrain lointain), Sodium Extra et Reese's Sodium Options. Le jeu tourne avec moins de FPS. Le serveur ne demande pas Sodium, tu peux toujours te connecter.

Décoche l'option pour tout remettre. Comme pour le mode PC modeste, les mods sont gardés en `.jar.disabled` et ne sont pas retéléchargés.

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
