# Envoi des rapports du launcher

## But

Quand le launcher détecte un crash ou un échec de lancement, il propose d'envoyer les journaux utiles à l'équipe Karamon. Le joueur n'a plus à chercher les fichiers lui-même. Rien ne part sans son accord, l'envoi ne bloque jamais le jeu, et un panel hors ligne ne fait rien perdre.

## Contrat réseau

Contrat fixé avec le panel Karamon, identique des deux côtés.

- `POST https://karamon.fr/panel/api/launcher/reports`, dans la constante unique `LAUNCHER_REPORTS_URL`. Route publique, 10 rapports par heure et par IP, 429 au-delà.
- Corps JSON compressé en gzip : `Content-Type: application/json`, `Content-Encoding: gzip`. Le JSON décompressé ne dépasse jamais 5 Mio.
- `Idempotency-Key` égal au `reportId` : un réessai après une réponse perdue n'est pas un second rapport.
- Réponse attendue : `{ "id": "<reportId>" }`.

Un rapport contient :

- `reportId` : UUID v4 ;
- `launcherVersion`, `packVersion`, `os`, `arch`, `javaVersion`, `ramMb` ;
- `gpu`, si Electron sait l'identifier (identifiants vendeur:modèle) ;
- `trigger` : `crash_early`, `crash`, `sync_failed`, `launch_failed` ou `manual` ;
- `summary` : 20 chaînes au plus, 200 caractères chacune, masquées ;
- `files` : objets `{ name, content }`, `name` étant un nom de fichier, jamais un chemin.

Pas de `playerName` : le pseudo n'aide pas au diagnostic. Il peut en revanche apparaître dans `latest.log`, et le texte de consentement le dit.

Fichiers admis (le panel renvoie 400 pour tout autre nom) :

- la fin de `launcher.log`, 256 Kio au plus ;
- la fin de `logs/latest.log`, 512 Kio au plus ;
- le dernier `crash-reports/crash-*.txt`, 1 Mio au plus ;
- le dernier `hs_err_pid*.log` du dossier du jeu, 1 Mio au plus.

Si le JSON dépasse 5 Mio malgré ces limites, le collecteur raccourcit d'abord les deux gros fichiers en gardant leur fin, puis retire un fichier. Il ne produit jamais un corps hors contrat.

## Collecte

- Chemins internes fixes : rien n'est choisi par le renderer ni par le joueur.
- Le fichier doit être un fichier régulier, pas un lien symbolique, et son `realpath` doit rester sous la racine autorisée (dossier de données du launcher ou dossier de l'instance). Un dossier `crash-reports` qui pointe ailleurs est refusé de la même façon.
- `packVersion` est la version enregistrée par la dernière synchronisation réussie (`.karamon-pack-version.json` dans l'instance). La collecte ne fait aucune requête réseau ; sans version enregistrée, la valeur est `inconnu`.
- Java, RAM configurée et GPU viennent de ce que le launcher connaît déjà, sans nouvelle authentification.

## Masquage

Chaque contenu et chaque résumé passent par `ReportRedactor` avant d'être écrits dans la file ou montrés au renderer. C'est un masquage au mieux : il retire ce que le launcher sait chercher. Il ne garantit pas qu'un journal soit anonyme.

Sont masqués :

- le dossier personnel réel et les chemins `C:\Users\<nom>`, `/home/<nom>`, `/Users/<nom>`, remplacés par `<user>` ;
- le nom de la machine (`os.hostname()`), quelle que soit la casse, remplacé par `<host>` (sauf noms trop courts ou génériques comme `pc` ou `localhost`) ;
- les adresses e-mail, remplacées par `<email>` ;
- les paramètres d'URL : tout ce qui suit `?` ou `#` dans une URL `http(s)` (codes OAuth, tickets) ;
- les jetons Microsoft, Xbox et Minecraft : JWT `eyJ…`, jetons `M.C…`/`M.R…`, jetons compacts `Ew…`, en-tête `XBL3.0 x=…;…` ;
- `accessToken`, `refreshToken`, `clientToken`, `session`, `Authorization`, `Bearer`, valeurs entre guillemets comprises ;
- les arguments de lancement `--accessToken`, `--session`, `--username`, `--uuid`, `--xuid`, `--clientId` ;
- les propriétés JVM `-D…` dont le nom contient `token`, `session`, `password`, `secret` ou `auth` ;
- les adresses IPv4 et IPv6, remplacées par `<ip>`.

Les expressions sont bornées : un journal de 1 Mio sans séparateur reste traité en temps linéaire (testé).

## Modules du processus principal

### `ReportCollector`

Collecte les métadonnées et les fins de fichiers. Les dépendances système sont injectées : les tests n'ont besoin ni d'Electron ni du réseau.

### `ReportQueue`

Rapports en attente sous `<données du launcher>/reports/`, un fichier gzip par rapport, écriture atomique.

- États : `awaiting-consent` ou `approved`.
- Dossier en 0700, fichiers en 0600 (un dossier créé plus ouvert est resserré).
- Durée de vie : 7 jours. Un rapport expiré est supprimé à la lecture.
- Trois rapports au plus. L'éviction retire d'abord les expirés, puis les rapports automatiques qui attendent un consentement, du plus ancien au plus récent. Les manuels et les approuvés ne partent qu'en dernier recours.
- Un fichier illisible ou corrompu est supprimé et journalisé, sans planter. Un `state.json` corrompu est réinitialisé.
- `state.json` garde aussi le dernier envoi automatique par trigger (un trigger automatique est ignoré pendant 10 minutes) et les envois manuels récents (3 par tranche de 10 minutes).

### `ReportTransport`

Compresse et poste un rapport, avec un délai de 10 secondes appliqué par `AbortController`.

- 2xx : envoyé. L'`id` renvoyé par le panel sert de code support.
- 408, 429, 5xx, erreur réseau, délai dépassé : à réessayer, en respectant `Retry-After` (secondes ou date HTTP, plafonné à 24 h).
- Autres 4xx (400, 401, 403, 404, 413) : refus définitif, le rapport est supprimé.

### `ReportManager`

Coordonne collecte, consentement, file et transport, et ne lève jamais d'erreur dans la synchronisation ou le lancement.

- Envoi automatique actif : le rapport est approuvé et envoyé. Sinon il attend le consentement et le renderer reçoit une demande (identifiant, trigger, résumé masqué).
- Au démarrage (fenêtre chargée, sans la retarder) : il réessaie les approuvés dont la date d'essai est passée, puis repropose les consentements en attente.
- Réessais : 5 tentatives au plus, avec un délai d'au moins 1 min, 5 min, 30 min, puis 2 h, ou plus si `Retry-After` le demande. Les réessais ont lieu au lancement suivant. Après la cinquième tentative, le rapport est supprimé.
- Un échec d'envoi ne déclenche jamais de nouvelle collecte ni de nouveau rapport.
- Un même rapport n'est jamais posté deux fois en parallèle.

## IPC

- invocation `reports:send-manual` ;
- invocation `reports:consent`, qui reçoit `{ reportId, send, always }` et rien d'autre ;
- événement `reports:consent-request`.

Le main vérifie que l'appel vient de la page du launcher (même `webContents`, origine `file:`) et que le rapport attend bien un consentement. Une réponse pour un rapport inconnu ou déjà traité est ignorée et n'active pas le réglage.

Résultat, en union discriminée :

- `sent { supportCode }` : code renvoyé par le panel, ou `null` s'il n'en a pas renvoyé ;
- `queued { nextAttemptAt }` ;
- `skipped { reason }` : `cooldown`, `manual_limit`, `declined`, `unknown_report` ;
- `failed { reason, retryable }`.

## Consentement et interface

`AppConfig.autoSendReports` est désactivé par défaut, y compris pour les configurations existantes. Le réglage est dans Paramètres.

Le dialogue pose la question « Un problème a été détecté. Envoyer le rapport à l'équipe Karamon pour qu'on t'aide ? ». Il dit ce qui est masqué, que le pseudo Minecraft peut apparaître dans les journaux du jeu, et que « Ne pas envoyer » supprime le rapport. Il propose :

- `Envoyer` ;
- `Ne pas envoyer` : supprime le rapport ;
- la case `Toujours envoyer automatiquement`.

Fermer le dialogue sans répondre garde le rapport, qui est reproposé au lancement suivant (dans la limite des 7 jours).

Décocher le réglage dans Paramètres supprime les rapports approuvés qui ne sont pas encore partis.

La carte Rapports de crash de l'écran Outils garde le bouton `Envoyer mes logs à l'équipe`. Ce clic vaut consentement pour ce rapport seulement (trigger `manual`).

Le code support n'est affiché qu'après acceptation par le panel. Avant, l'interface affiche « Rapport en attente. » et rien d'autre. Les échecs ne montrent rien au joueur : ils ne vont que dans `launcher.log`.

## Déclencheurs

- Minecraft sort avec un code non nul en moins de deux minutes : `crash_early` ;
- après deux minutes : `crash` ;
- la synchronisation du pack échoue, seule ou pendant Jouer : `sync_failed` ;
- Java, les librairies, les assets, le profil ou le lancement du processus échouent : `launch_failed` ;
- bouton de l'écran Outils : `manual`.

Une sortie ne compte pas si l'arrêt a été demandé : signal `SIGTERM`, `SIGINT` ou `SIGHUP` (fermeture par le joueur, fin de session), ou arrêt demandé par le launcher (`stopRequested`). Le launcher n'arrête jamais le jeu aujourd'hui, ce drapeau reste donc à `false` tant qu'aucun bouton Arrêter n'existe. `SIGKILL` et `SIGSEGV` restent des crashs (manque de mémoire, plantage de la JVM).

`MinecraftLauncher` indique la phase qui a échoué, pour que `KaramonApp` ne déduise pas le trigger d'un texte affiché.

## Points écartés

- **Consentement avant toute collecte.** On garde la capture locale : elle reste sur la machine du joueur, rien ne sort sans son accord, et la durée de vie est de 7 jours.
- **Consentement à trois états avec `policyVersion`.** Le booléen suffit, avec la suppression des approuvés quand le réglage est décoché.
- **Chiffrement de la file.** Les permissions 0700/0600 suffisent : ces journaux sont déjà en clair sur le disque du joueur.
- **Regroupement des incidents par empreinte.** Reporté à plus tard.

## Vérification

TDD. Les tests couvrent :

- chaque motif de masquage, Windows, macOS et Linux, et le temps linéaire sur 1 Mio ;
- les limites par fichier et la limite de 5 Mio ;
- le refus des liens symboliques, fichiers et dossiers ;
- la version du pack lue sur disque, et sa conservation quand `pack.json` est injoignable ;
- la file : persistance, TTL, ordre d'éviction, permissions, fichiers corrompus, tentatives ;
- les délais : 10 minutes par trigger automatique, 3 envois manuels par 10 minutes ;
- le transport : en-têtes, `Idempotency-Key`, 2xx/408/429/4xx/5xx, `Retry-After`, délai dépassé ;
- le manager : consentement, refus, réponse invalide, envoi automatique, 5 tentatives, désactivation du réglage, échec silencieux ;
- les déclencheurs, arrêt demandé compris ;
- les messages montrés au joueur.

La branche passe le typecheck, toute la suite de tests et le build. La PR n'est ni fusionnée ni publiée.

## À valider côté launcher

- les plafonds de 1 Mio pour `crash-*.txt` et `hs_err_pid*.log` ;
- la file à 3 rapports, avec les manuels et approuvés évincés en dernier recours si la file en est pleine ;
- l'abandon après 5 tentatives et le calendrier des délais ;
- le traitement des réponses : 400, 401, 403, 404 et 413 abandonnés ; 408, 429 et 5xx réessayés ;
- le réessai au lancement suivant uniquement (pas de minuterie pendant la session) ;
- `inconnu` pour une version absente (pack jamais synchronisé, Java non détecté) ;
- la limite manuelle de 3 envois par 10 minutes ;
- le code support : les 8 premiers caractères de l'`id` renvoyé, en majuscules ;
- sous Windows, « Fin de tâche » termine le jeu avec un code non nul sans signal : il compte comme un crash.

## À valider côté panel (@karamon)

- plafond de taille compressée **et** décompressée, contre les bombes gzip ;
- validation du schéma (noms de fichiers, `summary` 20 × 200, types) ;
- déduplication par `Idempotency-Key` ;
- limite de débit (10 par heure et par IP aujourd'hui) ;
- durée de conservation des rapports ;
- accès restreint à l'équipe ;
- URL définitive de `LAUNCHER_REPORTS_URL`.
