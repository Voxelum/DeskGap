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
