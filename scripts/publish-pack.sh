#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-vskstudio/Karamon-launcher}"
VERSION="${1:-}"
if [[ -z "$VERSION" || $# -lt 2 ]]; then
  echo "Usage: $0 X.Y.Z file [file...]" >&2
  exit 1
fi
shift

TAG="pack-v${VERSION}"
TITLE="Karamon Pack ${VERSION}"
NOTES="Pack client Karamon ${VERSION}: Cobbleverse + extras. Le launcher telecharge mods.zip depuis le tag pack-latest."

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "Fichier introuvable: $file" >&2
    exit 1
  fi
done

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$@" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --title "$TITLE" --notes "$NOTES"
else
  gh release create "$TAG" "$@" \
    --repo "$REPO" \
    --title "$TITLE" \
    --latest=false \
    --notes "$NOTES"
fi

if gh release view pack-latest --repo "$REPO" >/dev/null 2>&1; then
  gh release delete pack-latest --repo "$REPO" --yes --cleanup-tag
fi

gh release create pack-latest "$@" \
  --repo "$REPO" \
  --title "${TITLE} (latest)" \
  --latest=false \
  --notes "Alias du pack ${VERSION}. Le launcher telecharge depuis ce tag, pas depuis /releases/latest."

echo "OK ${TAG} + pack-latest sur ${REPO}"
