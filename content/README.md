# Pack client Karamon (`content/`)

Copie des manifestes du pack client (Cobbleverse 1.7.42 Fabric + extras Karamon): mods, resource packs, shaders optionnels.

La source qui fait foi est `content/` de [`vskstudio/Karamon`](https://github.com/vskstudio/Karamon). Sa CI « Publish pack » construit le pack et le publie sur:

```
https://karamon.fr/downloads/
```

C'est là que le launcher synchronise le pack (`cdnBaseUrl` dans `pack.json`). Ici, seuls `pack.json` et `client-options.json` servent: ils sont embarqués dans le launcher au build comme valeurs par défaut (version de Minecraft et de Fabric, CDN, ordre des resource packs, shader). Les binaires (`.jar`, `.zip`) ne sont pas commités.

Le tag `pack-latest`, lu par les launchers jusqu'à 2.0.10, n'existe plus.

## Structure

| Fichier | Rôle |
|---------|------|
| `pack.json` | Meta pack (MC, Fabric, CDN, jars client à désactiver) |
| `client-options.json` | Ordre forcé des resource packs + shader Iris |
| `mods/required.json` | Mods obligatoires |
| `mods/optional.json` | Mods optionnels |
| `resourcepacks/required.json` | Resource packs obligatoires |
| `shaderpacks/optional.json` | Shader packs proposés |

## Publier

Rien à faire ici: tout push sur `main` de `vskstudio/Karamon` qui touche `content/` ou `mod/` republie le pack sur karamon.fr.

Pour resynchroniser cette copie, recopier `content/*.json` et `content/*/*.json` depuis `vskstudio/Karamon`. Le test `src/main/features/minecraft/OptionsWriter.test.ts` vérifie `client-options.json` (haut de la pile de resource packs, shader): l'ajuster dans le même commit si ces valeurs changent.

### `scripts/publish-pack.sh` et le tag `pack-latest`

Le script publie `pack-vX.Y.Z`, prépare la nouvelle release sous `pack-latest-next-X.Y.Z`, puis bascule : la release `pack-latest` en place est renommée `pack-latest-retired-X.Y.Z`, et la nouvelle prend le tag `pack-latest`.

Ce qui reste : GitHub refuse deux releases sur le même tag, donc la bascule demande deux appels successifs et, entre les deux, aucune release ne porte `pack-latest`. Un launcher qui lit `releases/download/pack-latest/...` ou `releases/tags/pack-latest` à ce moment reçoit un 404. Le script réduit cette fenêtre à un seul appel `PATCH /releases/{id}` (identifiants lus avant la bascule) et remet l'ancienne release sous `pack-latest` si le second appel échoue. La fenêtre n'a pas été mesurée sur GitHub.

Essai à faire avant de s'y fier, sur un dépôt de test et jamais sur celui-ci : publier deux versions de suite avec `REPO=<compte>/<depot-de-test> scripts/publish-pack.sh 0.0.1 mods.zip assets.zip` puis `0.0.2`, en interrogeant `https://github.com/<compte>/<depot-de-test>/releases/download/pack-latest/mods.zip` en boucle (`curl -sI` toutes les 100 ms) pendant la seconde publication. Noter la durée des 404, vérifier qu'à la fin `pack-latest` sert bien les fichiers de 0.0.2, que `pack-latest-next-0.0.2` et `pack-latest-retired-0.0.2` ont disparu (releases et tags), et qu'un échec simulé du second appel (dans une copie du script, un identifiant de release faux pour `STAGING_ID`) laisse `pack-latest` sur 0.0.1.
