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

release_id() {
  gh api "repos/${REPO}/releases/tags/$1" --jq .id
}

retag_release() {
  gh api -X PATCH "repos/${REPO}/releases/$1" -f tag_name="$2" >/dev/null
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

STAGING_ID="$(release_id "$STAGING_TAG")"
LATEST_ID=""
if release_exists "$LATEST_TAG"; then
  LATEST_ID="$(release_id "$LATEST_TAG")"
fi
if [[ -n "$LATEST_ID" ]]; then
  retag_release "$LATEST_ID" "$RETIRED_TAG"
fi
if ! retag_release "$STAGING_ID" "$LATEST_TAG"; then
  if [[ -n "$LATEST_ID" ]]; then
    retag_release "$LATEST_ID" "$LATEST_TAG"
  fi
  echo "Bascule de ${LATEST_TAG} échouée, l'ancienne release a été remise sous ${LATEST_TAG}" >&2
  exit 1
fi
delete_tag_ref "$STAGING_TAG"

if release_exists "$RETIRED_TAG"; then
  gh release delete "$RETIRED_TAG" --repo "$REPO" --yes --cleanup-tag
fi

echo "OK ${TAG} + ${LATEST_TAG} sur ${REPO}"
