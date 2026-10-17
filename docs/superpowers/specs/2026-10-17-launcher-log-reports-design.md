# Envoi des rapports du launcher

## But

Quand le launcher détecte un crash ou un échec de lancement, il propose d'envoyer les journaux utiles à l'équipe Karamon. Le joueur n'a plus à chercher les fichiers lui-même. L'envoi reste soumis à son consentement, ne bloque jamais le jeu et continue de fonctionner si le panel est momentanément hors ligne.

## Contrat réseau

Le launcher envoie un `POST` HTTPS vers `LAUNCHER_REPORTS_URL`, constante unique dont la valeur provisoire doit être confirmée par l'équipe du panel Karamon. Le chemin public attendu est `/api/launcher/reports`.

Le corps est un objet JSON compressé avec gzip. Les en-têtes sont `Content-Type: application/json` et `Content-Encoding: gzip`. Le JSON décompressé ne dépasse jamais 5 Mio.

Un rapport contient :

- `reportId` : UUID v4 créé avant la collecte ;
- `launcherVersion`, `packVersion`, `os`, `arch`, `javaVersion`, `ramMb` ;
- `gpu` quand Electron sait l'identifier ;
- `trigger` : `crash_early`, `crash`, `sync_failed`, `launch_failed` ou `manual` ;
- `summary` : cause courte déjà calculée par `CrashReports` ou `CrashDiagnosis`, sinon message d'erreur anonymisé et limité ;
- `playerName` si un profil Minecraft est connecté ;
- `files` : objets `{ name, content }`.

Les fichiers admis sont :

- la fin de `launcher.log`, 256 Kio maximum ;
- la fin de `latest.log`, 512 Kio maximum ;
- le dernier `crash-reports/*.txt`, 1 Mio maximum ;
- le dernier `hs_err_pid*.log`, 1 Mio maximum.

Le plafond de 1 Mio des deux derniers fichiers est un choix provisoire à faire valider. Si la sérialisation dépasse 5 Mio malgré ces limites, le collecteur réduit d'abord les deux gros fichiers en conservant leur fin, puis retire un fichier optionnel. Il ne produit jamais un corps hors contrat.

`packVersion` vient du `pack.json` public du panel/CDN et utilise la version embarquée comme repli. Une collecte hors ligne reste donc possible. Le collecteur récupère la version Java détectée, la RAM configurée, le GPU Electron et le pseudo mis en cache, sans déclencher de nouvelle authentification.

## Anonymisation

Chaque contenu et chaque résumé passent par l'anonymiseur avant d'être écrit dans la file ou transmis au renderer.

L'anonymiseur :

- remplace le dossier personnel réel et les chemins `C:\Users\<nom>`, `/home/<nom>` et `/Users/<nom>` par `<user>` ;
- masque les valeurs de `accessToken`, `refreshToken`, `session`, `Authorization` et `Bearer`, y compris les arguments Java `--accessToken valeur` ;
- remplace les adresses IPv4 et IPv6 par `<ip>` ;
- ne modifie pas le reste du diagnostic.

Les noms envoyés sont des basenames, jamais des chemins complets. Les rapports en attente contiennent déjà les données anonymisées. Aucun secret n'est ajouté au code, à la config ou aux tests.

## Modules du processus principal

### `ReportRedactor`

Fonction pure d'anonymisation, testée avec des chemins Windows, macOS et Linux, les formes usuelles de jetons et les deux familles d'adresses IP.

### `ReportCollector`

Collecte les métadonnées et les fins de fichiers. Les dépendances système (version du launcher, GPU, Java, profil, pack distant) sont injectées pour que les tests n'aient pas besoin d'Electron ni du réseau public.

### `ReportQueue`

Conserve les rapports sous le dossier de données du launcher avec écriture atomique. Un rapport est soit `awaiting-consent`, soit `approved`. La file contient au plus trois rapports au total ; si un quatrième arrive, le plus ancien est retiré. Ce partage de limite entre les deux états est provisoire et doit être validé.

La file conserve aussi le dernier instant d'envoi automatique pour chaque trigger. Un trigger automatique est ignoré s'il a déjà été pris en charge dans les dix dernières minutes. `manual` n'est pas limité.

### `ReportTransport`

Compresse et envoie un rapport. Une réponse 2xx confirme l'envoi. Une erreur réseau, un 429 ou un 5xx conserve le rapport pour le prochain lancement. Les autres 4xx sont journalisés puis retirés pour éviter une boucle sans fin. Ce traitement des 4xx est provisoire et doit être validé.

### `ReportManager`

Coordonne collecte, consentement, file et transport. Au démarrage, il réessaie les rapports approuvés, puis présente les rapports qui attendent un consentement quand la fenêtre est prête. Il ne lève jamais une erreur dans le flux de synchronisation ou de lancement du jeu.

Si l'option d'envoi automatique est active, le rapport est approuvé et envoyé directement. Sinon, la preuve anonymisée est conservée et le renderer reçoit une demande de consentement. Cela couvre le cas où le launcher se ferme au démarrage du jeu : le dialogue apparaît au prochain lancement, sans perdre le crash.

## Consentement et interface

`AppConfig` reçoit `autoSendReports: boolean`, désactivé par défaut. Le réglage apparaît dans Paramètres et reste modifiable.

Le dialogue affiche exactement : « Un problème a été détecté. Envoyer le rapport à l'équipe Karamon pour qu'on t'aide ? » avec :

- `Envoyer` ;
- `Pas maintenant` ;
- la case `Toujours envoyer automatiquement`.

`Pas maintenant` supprime le rapport courant, garde `autoSendReports` désactivé et laisse une future détection reposer la question. Ce comportement est provisoire et doit être validé.

La carte Rapports de crash de l'écran Outils contient toujours le bouton `Envoyer mes logs à l'équipe`, même quand aucun crash n'est listé. Cette action vaut consentement pour ce rapport uniquement et utilise le trigger `manual`.

Après une acceptation ou un envoi manuel, l'interface affiche les huit premiers caractères du `reportId`. Si le panel est hors ligne, elle indique que le rapport attend le prochain lancement tout en montrant le même code.

Les nouveaux canaux IPC sont :

- invocation `reports:send-manual` ;
- invocation `reports:consent` ;
- événement `reports:consent-request`.

Le résultat public porte un statut `sent`, `queued`, `skipped` ou `failed`, ainsi que le code court quand un rapport existe.

## Déclencheurs

- Minecraft sort avec un code non nul en moins de deux minutes : `crash_early` ;
- Minecraft sort avec un code non nul après deux minutes : `crash` ;
- la synchronisation du pack échoue, seule ou pendant Jouer : `sync_failed` ;
- Java, les librairies, les assets, le profil ou le spawn échouent : `launch_failed` ;
- bouton de l'écran Outils : `manual`.

`MinecraftLauncher` signale explicitement la phase qui a échoué afin que `KaramonApp` ne déduise pas le trigger depuis un texte traduit. Un crash précoce ne produit pas en plus un rapport `crash`.

## Hors ligne et démarrage

La route du panel peut ne pas exister au moment où la PR est testée. Dans ce cas, l'acceptation affiche un rapport en attente, le jeu continue normalement et le prochain lancement réessaie une seule fois chaque rapport approuvé. Aucun message d'erreur technique ne bloque le joueur.

Les traitements réseau de rapport ont un délai court et restent distincts des téléchargements du pack. Quitter le launcher pendant un envoi ne corrompt pas la file.

## Vérification

L'implémentation suit TDD. Les tests couvrent au minimum :

- tous les motifs d'anonymisation et leur combinaison ;
- les limites de fichier et la limite JSON de 5 Mio ;
- le choix du dernier crash et du dernier `hs_err` ;
- la file persistante, le maximum de trois et le redémarrage ;
- le délai de dix minutes par trigger ;
- les réponses 2xx, 429, 4xx, 5xx et l'absence de réseau ;
- le consentement, l'option automatique, le bouton manuel et le code court ;
- la classification des quatre déclencheurs automatiques ;
- la compatibilité de la configuration existante.

La branche doit passer le typecheck, toute la suite de tests et le build. Une revue de code est faite avant d'ouvrir la PR. La PR n'est ni fusionnée ni publiée.

## À valider dans la PR

- la valeur publique finale de `LAUNCHER_REPORTS_URL` pour le panel Karamon ;
- la limite de 1 Mio pour le crash report et le fichier `hs_err` ;
- le maximum de trois partagé entre rapports en attente de consentement et rapports approuvés ;
- l'abandon des 4xx hors 429 ;
- la suppression du rapport courant après `Pas maintenant`, avec nouvelle demande au prochain incident ;
- l'affichage du code court même quand le rapport est encore en attente d'envoi.
