# macOS App headless smoke test

After configuring and building `deskgap` from the repository root:

```sh
cmake --build build-macos-arm64 --target deskgap -j 4
mkdir -p build-macos-arm64/native-smoke
clang++ -std=c++17 -fobjc-arc -Ilib/src/include \
  lib/tests/mac/app_smoke.mm \
  build-macos-arm64/lib/src/platform/libdeskgap_platform.a \
  -framework AppKit -framework ApplicationServices \
  -o build-macos-arm64/native-smoke/app_smoke
build-macos-arm64/native-smoke/app_smoke
```

The test runs a Foundation/CFRunLoop command-line program, not NSApplication.
It checks lock ownership, repeated requests, a separate competing process,
second-instance callback arguments/cwd, release/reacquisition, process-exit
cleanup without explicit release, and unsupported/invalid protocol rejection.
It never changes default protocol handlers.

## Semantics and remaining integration checks

- Single-instance ownership uses an exclusive CFMessagePort in the current
  login session, named using uid and SHA-256 of the canonical executable path.
  Different executable installations and different login sessions are separate.
  Registration failure returns false; it never assumes ownership. IPC delivery
  is best effort, bounded to 1 MiB and a one-second send timeout. Delivery occurs
  on the main run loop, so a blocked/nonrunning UI loop cannot deliver callbacks.
  The port is local IPC, not an authentication boundary against other processes
  already running in the same user's login session. Received payloads are parsed
  as immutable property lists with strict shape/type/size checks, never executed.
- A repeated successful request preserves the original callback. Explicit
  release removes the run-loop source and invalidates the port; OS process
  termination also reclaims ownership. Request uses the UI thread as in the
  current Node binding; state queries/release are synchronized with a mutex.
- The native callback retains the existing space-separated command-line ABI.
  Node currently uses `args.split(' ')`; arguments containing spaces therefore
  cannot round-trip exactly (the same existing binding limitation on Windows).
  Correcting this requires a separate cross-platform binding/API change.
- Protocol APIs reject bare executables and schemes absent from the main `.app`
  bundle's `CFBundleURLTypes`/`CFBundleURLSchemes` or missing bundle identifier.
  For an eligible bundle they query/set Launch Services, returning actual status
  rather than claiming registration. They do not edit bundle metadata.
- Not tested here: a packaged app with declared custom scheme, positive default
  handler registration/query/open-url dispatch, sandbox entitlements, actual GUI
  event-loop/Node integration, tray UI, concurrent stress, or separate login
  sessions. Positive protocol tests intentionally require an explicit opt-in
  because they mutate the user's Launch Services preferences.
- Current SDK warns about the existing tray `popUpStatusItemMenu:` call and the
  Launch Services query `LSCopyDefaultHandlerForURLScheme` (deprecated since
  macOS 10.15). Both compile and link; deployment/API modernization is separate.
