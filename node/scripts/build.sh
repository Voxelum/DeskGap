#!/usr/bin/env bash
set -e
scriptDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
deskGapNodeDir=$scriptDir/..

rm -rf dist_build

if [[ "$OSTYPE" == "linux-gnu" ]] || [[ "$OSTYPE" == "darwin"* ]]; then
  cmake -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Release -S "$deskGapNodeDir" -B dist_build
  cmake --build dist_build
else
  unset ALL_PROXY HTTP_PROXY HTTPS_PROXY NO_PROXY
  cmake -G "Visual Studio 17 2022" -A x64 -S "$deskGapNodeDir" -B dist_build
  cmake --build dist_build --config Release
fi

cd dist_build
ls
mkdir dist
if [[ "$OSTYPE" == "linux-gnu" ]]; then
  mkdir dist/DeskGap
  cp Release/DeskGap/DeskGap dist/DeskGap
  cp -r Release/DeskGap/resources dist/DeskGap
  strip -x dist/DeskGap/DeskGap
elif [[ "$OSTYPE" == "darwin"* ]]; then
  cp -r DeskGap.app dist
  strip -x dist/DeskGap.app/Contents/MacOS/DeskGap
else
  mkdir dist/DeskGap
  cp Release/DeskGap/deskgap_winrt.dll dist/DeskGap
  cp Release/DeskGap/DeskGap.exe dist/DeskGap
  cp -r Release/DeskGap/resources dist/DeskGap
fi

version="$(tr -d '\r\n' < "$deskGapNodeDir/VERSION")"
if [[ "$OSTYPE" == "linux-gnu" ]] || [[ "$OSTYPE" == "darwin"* ]]; then
  platform="$(node -p "process.platform + '-' + process.arch")"
else
  platform="win32-x64"
fi
if [[ "$OSTYPE" == "darwin"* ]]; then
  appDirectory="dist/DeskGap.app/Contents/Resources/app"
else
  appDirectory="dist/DeskGap/resources/app"
fi
node "$scriptDir/package-application.mjs" "$appDirectory" "dist/app-${version}-${platform}.tar.zst" "$version"

if [[ "$OSTYPE" != "linux-gnu" ]] && [[ "$OSTYPE" != "darwin"* ]]; then
  rm -rf "dist/DeskGapClickRuntime"
  cp -r "dist/DeskGap" "dist/DeskGapClickRuntime"
  rm -rf "dist/DeskGapClickRuntime/resources/app"
  node "$scriptDir/package-click-to-run.mjs" \
    "Release/DeskGapBootstrap.exe" \
    "dist/DeskGapClickRuntime" \
    "$appDirectory" \
    "dist/DeskGap-${version}-${platform}.exe" \
    "$version"
  cp "Release/DeskGapBootstrap.exe" "dist/DeskGapBootstrap-v${version}-${platform}.exe"
  rm -rf "dist/DeskGapClickRuntime"
fi
