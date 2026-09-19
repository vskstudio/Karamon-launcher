# Pack client Karamon (`content/`)

Source de vérité versionnée pour le pack client (Cobbleverse 1.7.42 Fabric + extras Karamon): mods, resource packs, shaders optionnels.

Les binaires (`.jar`, `.zip`) ne sont pas commités. Le launcher synchronise depuis `cdnBaseUrl` dans `pack.json`:

```
https://github.com/vskstudio/Karamon-launcher/releases/download/pack-latest/
```

Le tag `pack-latest` est un alias du dernier `pack-vX.Y.Z`. Il n'est jamais marqué Latest, pour laisser `/releases/latest` au launcher.

## Structure

| Fichier | Rôle |
|---------|------|
| `pack.json` | Meta pack (MC, Fabric, CDN, jars client à désactiver) |
| `mods/required.json` | Mods obligatoires |
| `mods/optional.json` | Mods optionnels |
| `resourcepacks/required.json` | Resource packs obligatoires |
| `shaderpacks/optional.json` | Shader packs proposés (pas requis pour rejoindre) |

## Publier

Le zip se construit depuis KaramonV2 (`node scripts/build-content-pack.mjs`), puis:

```bash
./scripts/publish-pack.sh 0.5.3 content/dist/downloads/mods.zip content/dist/downloads/*.json
```

Le script crée `pack-vX.Y.Z` et met à jour `pack-latest` (les deux avec `--latest=false`).
