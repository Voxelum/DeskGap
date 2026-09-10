#!/usr/bin/env bash
set -e
scriptDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
echo $scriptDir$

rm -rf ./npm_test && cp -r $scriptDir/../npm/test ./npm_test
cd npm_test
echo "Installing dependencies of npm_test"
npm install --ignore-scripts
echo "Installing DeskGap to npm_test"
npm install --ignore-scripts "$DESKGAP_NPM_TEST_INSTALL_WHAT"
# Exercise the known installer explicitly rather than depending on npm's
# version-specific dependency lifecycle-script approval policy.
(cd node_modules/deskgap && node install.js)
npm test
