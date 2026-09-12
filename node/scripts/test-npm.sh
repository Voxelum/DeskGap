#!/usr/bin/env bash
set -e
scriptDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
echo $scriptDir$

rm -rf ./npm_test && cp -r $scriptDir/../npm/test ./npm_test
cd npm_test
echo "Installing DeskGap and dependencies to npm_test"
if [[ -f "$DESKGAP_NPM_TEST_INSTALL_WHAT" ]]; then
  npm install --ignore-scripts "deskgap@file:$DESKGAP_NPM_TEST_INSTALL_WHAT"
else
  npm install --ignore-scripts "deskgap@npm:$DESKGAP_NPM_TEST_INSTALL_WHAT"
fi
# Exercise the known installer explicitly rather than depending on npm's
# version-specific dependency lifecycle-script approval policy.
(cd node_modules/deskgap && node install.js)
npm test
