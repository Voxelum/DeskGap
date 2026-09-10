#!/usr/bin/env bash
set -e
scriptDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
deskgapVersion="$(tr -d '\r\n' < "$scriptDir/../VERSION")"

distsDir=$1
if [ ! -d "$distsDir" ]; then
    echo "The distsDir folder does not exist: $distsDir"
    exit 1
fi

echo "Preparing the npm package..."
rm -rf ./npm && cp -r $scriptDir/../npm .
cp $scriptDir/../../docs/README.md ./npm
node -e "fs.writeFileSync('./npm/package.json', JSON.stringify(Object.assign(require('./npm/package.json'), { version: '$deskgapVersion'})))"
npm --prefix "$scriptDir/../.." run tsd -- --declarationDir "$PWD/npm/types" --pretty false

echo "Zipping binaries..."
mkdir npm/dist_files
rm -rf dist_zips && mkdir dist_zips
for distFolder in $distsDir/*; do
  distName=`basename $distFolder`
  zipFilename=deskgap-v$deskgapVersion-$distName.zip
  zipFilePath="$PWD/dist_zips/$zipFilename"
  fileInfoJSONPath="$PWD/npm/dist_files/$distName.json"

  pushd "$distFolder"
  runtimeFolder=DeskGap
  if [[ "$distName" == darwin-* ]]; then runtimeFolder=DeskGap.app; fi
  # Actions artifact downloads do not preserve Unix executable permissions.
  if [[ "$distName" == linux-* ]]; then chmod +x "$runtimeFolder/DeskGap"; fi
  if [[ "$distName" == darwin-* ]]; then chmod +x "$runtimeFolder/Contents/MacOS/DeskGap"; fi
  zipInputs=("$runtimeFolder")
  if [[ "$distName" == win32-* ]]; then
    zipInputs+=("DeskGapBootstrap-v${deskgapVersion}-${distName}.exe")
  fi
  cmake -E tar cf "$zipFilePath" --format=zip -- "${zipInputs[@]}"
  sha256output=( `cmake -E sha256sum "$zipFilePath"` )
  echo \{\"filename\":\"$zipFilename\",\"sha256\":\"${sha256output[0]}\"\} > "$fileInfoJSONPath"
  popd
  # Publish application payloads and Windows packaging tools without requiring
  # consumers to unpack the complete runtime distribution first.
  for artifact in "$distFolder"/*.tar.zst "$distFolder"/*.metadata.json "$distFolder"/*.exe; do
    if [ -f "$artifact" ]; then cp "$artifact" dist_zips/; fi
  done
done

echo "Packing the npm package..."
npmPackFileName=$(npm pack --quiet ./npm)
mv "$npmPackFileName" npm.tgz
cp npm.tgz dist_zips/npm.tgz
(cd dist_zips && sha256sum -- * > SHA256SUMS)
