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
