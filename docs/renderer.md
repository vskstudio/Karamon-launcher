# Renderer du launcher

Preact 11, `@preact/signals`, JSX compilé par esbuild. Pas de framework CSS : des tokens, le kit pixel du menu K et un CSS colocalisé par composant.

## Où vit quoi

| Dossier | Rôle |
|---|---|
| `src/renderer/ui/` | Bibliothèque de composants. Aucune dépendance vers l'état de l'app. |
| `src/renderer/ui/tokens.css` | Couleurs, espacements, polices, tailles de contrôle. Toute valeur visuelle passe par là. |
| `src/renderer/ui/kit.css` | Les images 9-slice du kit (`--kit-card`, `--kit-primary`, `--kit-tab`…) et les surfaces `.kit--card`, `.kit--frame`, `.kit--inset`, `.kit--violet`. |
| `src/renderer/state/` | Un store par domaine, en signals. Les composants lisent `store.value` et appellent ses fonctions. |
| `src/renderer/app/` | Coquille : barre de titre, sidebar, console, bandeaux, registre des pages, démarrage. |
| `src/renderer/pages/<id>/` | Une page par dossier : `<Id>Page.tsx`, ses sous-composants, son CSS. |
| `src/renderer/features/` | Ce qui n'est pas une page mais vit au-dessus d'elles (dialog des comptes, consentement des rapports). |
| `src/renderer/assets/` | Kit, icônes pixel, illustrations, marque. Importés en ES, esbuild les embarque. |

## Ajouter une page

1. Créer `src/renderer/pages/<id>/<Id>Page.tsx` qui exporte `function <Id>Page({ param }: { param: string | null })` et rend un `<Page label="…">`.
2. Ajouter l'id au type `PageId` de `state/navigation.ts`.
3. Ajouter une ligne dans `routes` de `app/routes.ts` (libellé, icône pixel, section, composant). La sidebar se génère toute seule.

Pour ouvrir une page depuis ailleurs : `navigate('wiki', 'fin-de-saison')`. Le second argument arrive dans `param`.

## Ajouter un composant

1. `src/renderer/ui/components/<Nom>.tsx` et `<Nom>.css` à côté, importé par le composant.
2. L'exporter depuis `src/renderer/ui/index.ts`.
3. Les surfaces pixel reprennent une variable du kit : `border-style: solid; border-color: transparent; border-width: var(--kit-edge); border-image: var(--kit-button);`.

Règles de la bibliothèque :

- pas d'élément natif brut dans les pages : slider, case à cocher, interrupteur, champs et onglets passent par `ui` ;
- chiffres et prix en Inter (`.num`), la police pixel est réservée aux titres, à la navigation et aux onglets ;
- chaque composant interactif a un focus visible, un survol discret et un nom accessible court ;
- `Dialog` et `Menu` s'empilent : Échap ne ferme que le dessus de la pile, le focus revient à l'élément d'origine.

## Ajouter un store

Un fichier `src/renderer/state/<domaine>.ts` qui exporte ses signals et ses actions. Les appels au processus principal passent par `api` (`state/api.ts`), typé par `src/ipc/contract.ts`.

Toute action longue sur l'installation (jouer, synchroniser, réparer, se connecter) passe par `state/tasks.ts` : une seule à la fois, progression et état du jeu centralisés, `onTaskCompleted` pour recharger ce qui en dépend.

## Tailles de fenêtre

La fenêtre est en 16:9, de 1024 × 576 jusqu'au plein écran, et `WindowSize.ts` agrandit toute l'interface sur les grands écrans (1,25 en 1440p, 1,75 sur un écran 4K à 100 %, 2 au plus). Les mises en page ne dépendent donc pas de la fenêtre mais de la zone de contenu, à droite de la barre latérale : `.shell__main` est un conteneur nommé `content`.

| Requête | Zone de contenu | Usage |
|---|---|---|
| `@container content (max-width: 719px)` | très étroite | grilles de cartes qui passent sur une colonne |
| `@container content (max-width: 959px)` | compacte | colonnes doubles qui s'empilent |
| `@container content (min-width: 1360px)` | large | grilles qui gagnent une colonne |

Un composant qui doit s'adapter à sa propre largeur (carte du Pass) déclare son conteneur sur un enveloppant, car une requête de conteneur ne s'applique pas au conteneur lui-même. Les hauteurs basses restent des `@media (max-height: …)`.
