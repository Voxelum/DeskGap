#!/usr/bin/env bash
set -e
scriptDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > $HOME/.npmrc
npm publish $DESKGAP_NPM_TARBALL --tag=$DESKGAP_AP_NPM_TAG
