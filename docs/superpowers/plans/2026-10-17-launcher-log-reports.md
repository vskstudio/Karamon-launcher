# Envoi des rapports du launcher — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collecter, anonymiser, mettre en attente et envoyer au panel Karamon les preuves d'un problème, avec consentement du joueur et sans bloquer le lancement.

**Architecture:** Quatre modules purs (`ReportRedactor`, `ReportCollector`, `ReportQueue`, `ReportTransport`) sont coordonnés par `ReportManager` dans le processus principal. Le renderer ne reçoit que des demandes déjà anonymisées et renvoie le choix du joueur par IPC. Les phases du lancement produisent des triggers typés plutôt que déduits des messages.

**Tech Stack:** TypeScript, Node.js (`fs`, `crypto`, `zlib`, `https`), Electron IPC, bibliothèque UI interne, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-17-launcher-log-reports-design.md`

## Contraintes globales

- `POST /api/launcher/reports`, JSON gzippé, 5 Mio décompressé maximum.
- URL unique `LAUNCHER_REPORTS_URL`, valeur panel provisoire listée dans la PR.
- Aucun contenu non anonymisé n'est persisté ou envoyé au renderer.
- Maximum trois rapports locaux et un auto-rapport par trigger toutes les dix minutes.
- Le diagnostic ne bloque jamais synchro, lancement ou fermeture du jeu.
- PR seulement : aucune fusion, release, publication ou notification Discord réelle.

## Points de revue

- Une fin de fichier commence au milieu d'un caractère UTF-8 : elle doit rester décodable et ne pas casser le JSON.
- Un chemin contient à la fois le home réel et une IP : les deux informations doivent disparaître en un seul passage.
- Le panel répond 429 pendant que trois rapports sont déjà en attente : aucun rapport ne doit être envoyé en boucle ni dépasser la limite locale.
- La fenêtre est fermée quand Minecraft plante : le rapport doit demander le consentement au lancement suivant.
- Un échec de synchronisation pendant le bouton Jouer doit être `sync_failed`, pas `launch_failed`.

---

### Tâche 1 : anonymiseur

**Fichiers :**
- Créer : `src/main/features/reports/ReportRedactor.ts`
- Tester : `src/main/features/reports/ReportRedactor.test.ts`

**Interfaces :**
- Produit : `redactReportText(text: string, homeDir?: string): string`.

- [ ] Écrire les tests qui couvrent homes Windows/macOS/Linux, home injecté, tokens JSON/CLI/Bearer/session, IPv4/IPv6 et combinaison de plusieurs secrets.
- [ ] Lancer le test et constater l'échec car le module manque.
- [ ] Implémenter la fonction pure avec expressions bornées et remplacement stable `<user>`, `[masqué]`, `<ip>`.
- [ ] Relancer le test puis toute la suite.
- [ ] Committer.

### Tâche 2 : contrat, collecte et limite de taille

**Fichiers :**
- Créer : `src/main/features/reports/ReportTypes.ts`
- Créer : `src/main/features/reports/ReportCollector.ts`
- Tester : `src/main/features/reports/ReportCollector.test.ts`
- Modifier : `src/main/features/crashes/CrashReports.ts`
- Modifier : `src/main/shared/PackProfile.ts`

**Interfaces :**
- Produit : `ReportTrigger`, `LauncherReport`, `QueuedReport`, `ReportCollector.collect(input): Promise<LauncherReport>` et `CrashReports.summarize(content)` public.
- Consomme : `redactReportText` de la tâche 1.

- [ ] Écrire les tests de lecture de fin UTF-8, choix du dernier crash/hs_err, limites 256/512/1024 Kio, basenames, métadonnées facultatives et JSON inférieur à 5 Mio.
- [ ] Vérifier que les tests échouent faute de collecteur.
- [ ] Définir les types et implémenter un collecteur à dépendances injectées ; rendre le résumé de crash réutilisable ; ajouter `version` à `PackProfile`.
- [ ] Relancer les tests ciblés puis la suite.
- [ ] Committer.

### Tâche 3 : file persistante et transport gzip

**Fichiers :**
- Créer : `src/main/features/reports/ReportQueue.ts`
- Créer : `src/main/features/reports/ReportTransport.ts`
- Tester : `src/main/features/reports/ReportQueue.test.ts`
- Tester : `src/main/features/reports/ReportTransport.test.ts`

**Interfaces :**
- Produit : `ReportQueue.enqueue(report, state)`, `list(state?)`, `approve(id)`, `remove(id)`, `mayAutoSend(trigger, now)`, `markAutoSent(trigger, now)` ; `ReportTransport.send(report): Promise<'sent'|'retry'|'discard'>`.

- [ ] Écrire les tests de persistance, écriture atomique, limite trois (plus ancien retiré), états consent/approved, délai dix minutes persistant.
- [ ] Vérifier le rouge, implémenter `ReportQueue`, puis vérifier le vert.
- [ ] Écrire un test transport avec injection d'une fonction POST : en-têtes/gzip/JSON, 2xx, 429, 400, 500 et erreur réseau.
- [ ] Vérifier le rouge, implémenter `ReportTransport` et la constante unique `LAUNCHER_REPORTS_URL`, puis vérifier le vert.
- [ ] Lancer toute la suite et committer.

### Tâche 4 : orchestration, config et IPC

**Fichiers :**
- Créer : `src/main/features/reports/ReportManager.ts`
- Tester : `src/main/features/reports/ReportManager.test.ts`
- Modifier : `src/ipc/contract.ts`
- Modifier : `src/main/features/config/Config.ts`
- Modifier : `src/main/features/config/Config.test.ts`
- Modifier : `src/preload/preload.ts`
- Modifier : `src/main/KaramonApp.ts`

**Interfaces :**
- Produit : `ReportManager.detect(trigger, summary?)`, `sendManual()`, `answerConsent(id, send, always)`, `start()` ; IPC `reports:send-manual`, `reports:consent`, événement `reports:consent-request`.
- Consomme : tâches 2 et 3, config `autoSendReports`.

- [ ] Écrire les tests manager : détection avec option désactivée, auto activé, pas maintenant, toujours, manuel exempt, report différé, réessai démarrage et code court.
- [ ] Vérifier le rouge puis implémenter le manager minimal.
- [ ] Écrire les tests de migration/config pour `autoSendReports=false`, vérifier le rouge, ajouter le champ au contrat et à Config.
- [ ] Brancher preload et IPC KaramonApp, avec journalisation interne et erreurs absorbées.
- [ ] Relancer tests ciblés puis suite et committer.

### Tâche 5 : déclencheurs typés

**Fichiers :**
- Modifier : `src/main/features/minecraft/MinecraftLauncher.ts`
- Modifier : `src/main/features/minecraft/MinecraftLauncher.test.ts`
- Modifier : `src/main/KaramonApp.ts`
- Tester : `src/main/features/reports/ReportTriggers.test.ts` ou tests KaramonApp existants selon les points d'injection disponibles.

**Interfaces :**
- Produit : `MinecraftLaunchError` avec phase `sync` ou `launch`; sortie de jeu avec indicateur `early` et raisons de corruption.
- Consomme : `ReportManager.detect`.

- [ ] Écrire les tests : échec sync pendant Jouer => phase sync ; Java/spawn => phase launch ; sorties non nulles avant/après deux minutes => early/crash ; code zéro => aucun rapport.
- [ ] Vérifier le rouge.
- [ ] Implémenter l'erreur typée et enrichir le callback de sortie sans casser la réparation existante.
- [ ] Brancher `sync_failed`, `launch_failed`, `crash_early`, `crash` dans KaramonApp.
- [ ] Relancer tests ciblés puis suite et committer.

### Tâche 6 : consentement, réglage et envoi manuel

**Fichiers :**
- Créer : `src/renderer/features/reports/ReportConsent.ts`
- Tester : `src/renderer/features/reports/ReportConsent.test.ts`
- Modifier : `src/renderer/KaramonRenderer.ts`
- Modifier : `src/renderer/pages/SettingsPage.ts`
- Modifier : `src/renderer/pages/ToolsPage.ts`
- Modifier si nécessaire : CSS des pages concernées.

**Interfaces :**
- Consomme : nouvelles méthodes/events de `LauncherApi`.
- Produit : dialogue avec boutons et case, toggle `autoSendReports`, bouton manuel et message de résultat avec code.

- [ ] Écrire les tests DOM du dialogue : texte exact, choix envoyer/pas maintenant, case always, résultat sent/queued et code court.
- [ ] Vérifier le rouge puis implémenter `ReportConsent` avec la bibliothèque UI interne.
- [ ] Écrire ou compléter les tests d'écran pour le toggle et le bouton toujours visible ; vérifier le rouge.
- [ ] Brancher SettingsPage, ToolsPage et KaramonRenderer ; garder une seule demande de consentement visible à la fois.
- [ ] Relancer tests ciblés puis suite et committer.

### Tâche 7 : vérification et PR

**Fichiers :**
- Modifier : `README.md` uniquement si l'aide publique doit mentionner l'envoi consenti.
- Modifier : aucun workflow de release.

- [ ] Exécuter `npm run typecheck`, `npm test`, `npm run build` et `git diff --check`.
- [ ] Charger `superpowers:requesting-code-review`, faire une revue fraîche sécurité/consentement/erreurs, corriger par TDD.
- [ ] Charger `superpowers:verification-before-completion`, répéter les commandes finales et vérifier `git status`.
- [ ] Pousser seulement la branche et ouvrir une PR brouillon avec la section `À valider`, sans fusionner.
- [ ] Vérifier les checks de la PR et rendre compte avec son lien.
