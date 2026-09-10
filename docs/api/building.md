# Build Instructions

## Prerequisites

* [Node.js](https://nodejs.org/) 24 and npm 11
* [CMake](https://cmake.org) 3.20+
* Python 3.9 or newer, required only by Node.js's upstream source build
* At least 8 GB of memory for compiling Node.js

### macOS

* macOS 13.5 or newer
* Xcode 16.1 or newer

### Windows

* 64-bit Windows 10 or newer
* Visual Studio 2022 17.6 or newer with the Desktop development with C++ workload
* The C++ Clang Compiler for Windows and MSBuild support for LLVM toolset components
* NASM for OpenSSL assembly
* [NuGet CLI](https://www.nuget.org/downloads) for the WebView2 and WIL packages

### Linux

* GCC and G++ 12.2 or newer
* libgtk-3-dev version 3.18.9 or later
* libwebkit2gtk-4.1-dev version 2.40 or later
* libsecret-1-dev version 0.20 or later


## Steps

1. Download the npm dependencies: `npm ci`
2. Generate the buildsystem:
	- Windows: `cmake -G "Visual Studio 17 2022" -A x64 -S node -B build`
	- macOS or Linux: `cmake -DCMAKE_BUILD_TYPE=Release -S node -B build`
3. Build DeskGap:
	- Windows: `cmake --build build --config Release`
	- macOS or Linux: `cmake --build build`
4. Test:
	- macOS: `node node/test/start.js build`
	- Windows or Linux: `node node/test/start.js build/Release`

The first native build downloads the checksum-pinned Node.js 24.13.1 source
archive and compiles it as a static library inside the CMake build directory.
Subsequent builds reuse that output until the build directory or configured
Node version changes.

## GitHub binary releases

The CI workflow builds and exercises Windows x64, macOS x64, and Linux x64.
Pull requests targeting `webview2` run the same pipeline. ARM64 binaries are not
currently part of the release matrix.

After updating `node/VERSION`, its embedded copy `node/VERSION.txt`, and the
release notes, manually run CI on the
intended commit with `publish: true`. GitHub binary publishing does not require
an npm token. Set `publish_npm: true` only when also publishing to npm; that
separate job runs after the GitHub assets exist and requires `NPM_TOKEN`.
Prerelease versions remain prereleases even when the npm tag is `latest`.
Existing GitHub release assets are not overwritten: use a new version rather
than replacing bytes behind a published URL.

Each release includes:

* `deskgap-v<version>-<platform>-x64.zip`: runtime and embedded demo application;
  the Windows archive also includes the raw bootstrap for application packaging.
* `app-<version>-<platform>-x64.tar.zst` and `.metadata.json`: demo application
  payload and the size/hash/runtime API fields needed to sign an update manifest.
* `DeskGap-<version>-win32-x64.exe`: click-to-run demo application.
* `DeskGapBootstrap-v<version>-win32-x64.exe`: packaging stub, not a standalone app.
* `npm.tgz` and `SHA256SUMS`: npm package and checksums of all published artifacts.

The runtime ZIP omits the separately published payload and complete click-to-run
EXE to avoid downloading duplicate copies of the runtime. Consumers such as
XMCL should pin a runtime version, verify its checksum, bundle their own
application, and Authenticode-sign the complete single EXE through the existing
SignPath release process. XMCL publishes that EXE alongside its Electron assets
in the same ordinary release; no separate DeskGap release tag, application
payload asset, or update-signing key is required. DeskGap's demo payload is not
an XMCL update. Sign the assembled EXE, never the bootstrap before appending
payloads, and calculate release checksums only after signing.

A release build alone is not an application-parity guarantee. Before promoting
XMCL's DeskGap distribution, exercise packaged update/restart and recovery,
GitHub redirects and signing configuration, and the platform-specific desktop
flows on the corresponding OS. Windows signing/SmartScreen, macOS signing and
notarization, Linux installer handoff, and ARM64 remain separate distribution
gates; this workflow does not provision those credentials or claim those checks
have been completed.
