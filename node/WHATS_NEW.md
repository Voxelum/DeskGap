## 0.3.0-beta3 webview2 preview

- Node.js 24 and the Windows WebView2 runtime, with platform-native desktop APIs.
- Signed application updates using Ed25519 manifests, versioned tar.zst payloads,
  streaming progress and cancellation, and platform installer fallback.
- GitHub Releases redirect allowlists, immutable verified download handles, and
  retryable download failures.
- Version-consistent application packaging and Windows click-to-run packaging.
- Windows single-EXE updates with native Authenticode publisher verification and
  PID-aware installer handoff, reusing the application's existing signing process.
- Standalone runtime, bootstrap, application payload, npm tarball, and checksum
  release assets. GitHub binary publishing is independent of npm publishing.
- Public TypeScript declarations for the desktop API and updater.

This is a preview runtime, not a claim of complete XMCL/Electron parity.
The v0.3.0-beta2 tag and npm version are historical releases and are not updated.
This prerelease publishes GitHub binaries and an SDK tarball, not a new npm
registry version.
XMCL adds a SignPath-signed DeskGap EXE to its existing application releases;
it does not need a separate update-signing key or release stream. Platform signing,
macOS session/proxy limitations, and application-level migration gates remain
documented in the compatibility and build guides.
Windows Authenticode verification and click-to-run update handoff are implemented;
a genuinely SignPath-signed XMCL executable still needs its application-level
release acceptance. macOS and Linux runtime assets do not imply equivalent
application installer or persistent-session/proxy support.

## Legacy release notes

### Changed
- Downgrade Node.js to v12.4.0, because newer versions have issues running in the macOS sandbox

### Removed
- Node-webview communication methods: messageNode, messageUI, asyncNode

### Added
- A rpc-style node-webview communication methods (to be documented, see node/test/webview.js for examples)
