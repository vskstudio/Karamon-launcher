#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_MODULE="${SCRIPT_DIR}/../src/shared/Karamon.ts"
REPO="${REPO:-$(node --no-warnings --input-type=module -e "const { KARAMON } = await import(process.argv[1]); console.log(KARAMON.githubRepo);" "$PROFILE_MODULE")}"
VERSION="${1:-}"
if [[ -z "$VERSION" || $# -lt 2 ]]; then
  echo "Usage: $0 X.Y.Z file [file...]" >&2
  exit 1
fi
shift

TAG="pack-v${VERSION}"
TITLE="Karamon Pack ${VERSION}"
NOTES="Pack client Karamon ${VERSION}: Cobbleverse + extras. Le launcher telecharge mods.zip depuis le tag pack-latest."
LATEST_TAG="pack-latest"
STAGING_TAG="pack-latest-next-${VERSION}"
RETIRED_TAG="pack-latest-retired-${VERSION}"
LATEST_NOTES="Alias du pack ${VERSION}. Le launcher telecharge depuis ce tag, pas depuis /releases/latest."

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "Fichier introuvable: $file" >&2
    exit 1
  fi
done

release_exists() {
  gh release view "$1" --repo "$REPO" >/dev/null 2>&1
}

delete_tag_ref() {
  gh api -X DELETE "repos/${REPO}/git/refs/tags/$1" >/dev/null 2>&1 || true
}

if release_exists "$TAG"; then
  gh release upload "$TAG" "$@" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --title "$TITLE" --notes "$NOTES"
else
  gh release create "$TAG" "$@" \
    --repo "$REPO" \
    --title "$TITLE" \
    --latest=false \
    --notes "$NOTES"
fi

if release_exists "$STAGING_TAG"; then
  gh release delete "$STAGING_TAG" --repo "$REPO" --yes --cleanup-tag
fi
gh release create "$STAGING_TAG" "$@" \
  --repo "$REPO" \
  --title "${TITLE} (latest)" \
  --latest=false \
  --notes "$LATEST_NOTES"

if release_exists "$LATEST_TAG"; then
  gh release edit "$LATEST_TAG" --repo "$REPO" --tag "$RETIRED_TAG"
fi
gh release edit "$STAGING_TAG" --repo "$REPO" --tag "$LATEST_TAG"
delete_tag_ref "$STAGING_TAG"

if release_exists "$RETIRED_TAG"; then
  gh release delete "$RETIRED_TAG" --repo "$REPO" --yes --cleanup-tag
fi

echo "OK ${TAG} + ${LATEST_TAG} sur ${REPO}"
