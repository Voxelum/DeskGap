#!/usr/bin/env bash
set -euo pipefail

: "${NPM_TOKEN:?NPM_TOKEN is required for npm publishing}"
: "${DESKGAP_NPM_TARBALL:?DESKGAP_NPM_TARBALL is required}"
: "${DESKGAP_AP_NPM_TAG:?DESKGAP_AP_NPM_TAG is required}"
npmConfig="$(mktemp)"
trap 'rm -f "$npmConfig"' EXIT
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$npmConfig"
NPM_CONFIG_USERCONFIG="$npmConfig" npm publish "$DESKGAP_NPM_TARBALL" --tag="$DESKGAP_AP_NPM_TAG"
