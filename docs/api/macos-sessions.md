# macOS sessions

- The default session uses WebKit's default persistent website data store.
- Named persistent sessions (`session.fromName(name)` or `persist:name`) require
  macOS 14 or later. Older systems reject attachment explicitly; they never fall
  back to the default store. Default and ephemeral sessions remain available.
- On macOS 14+, the standardized, symlink-resolved profile `dataPath` and full
  case-sensitive UTF-8 session id (`persistent:` followed by the name) are
  length-prefixed and SHA-256 hashed with the `DeskGap.WKWebsiteDataStore.v1:`
  namespace. The first 16 bytes, with UUIDv8/variant bits set, identify a persistent
  `WKWebsiteDataStore` via `dataStoreForIdentifier:`. Same normalized path and id
  map consistently across windows and launches; distinct profiles/apps or names
  have distinct 122-bit hash identities (cryptographic collision probability,
  not a mathematical guarantee). Apps intentionally using the same profile path
  and name share identity. Missing profile paths are rejected. Do not change this
  mapping without planning a data migration.
- WebKit owns these stores' system-managed disk locations. `dataPath` selects
  the profile identity; it does **not** physically relocate the macOS WebKit
  store. Changing `sessionData` therefore selects a different store rather than
  moving existing data. This implementation provides no migration from another
  engine, custom directory, or default store.
- Ephemeral sessions use non-persistent stores cached by session id, sharing data
  only within that ephemeral session for the process lifetime.
- Per-session WebView proxy overrides remain unsupported and are rejected,
  including `mode: 'direct'`. Node-side `Session.fetch` is a separate HTTP stack;
  it does not imply shared WebKit cookies or proxy configuration.

## Focused verification

`node --test node/test/unit/session.js` covers JS identity/reuse, simulated
Darwin 22 rejection and Darwin 23+ acceptance, and continued proxy rejection.
These simulated boundaries do not test an actual older macOS runtime.
On macOS the same unit file also compiles the production identity helper verbatim
in a headless Foundation-only executable: same-path reuse, normalized paths,
different apps/profiles/names, Unicode, ambiguous delimiter inputs, and missing
path rejection. This test creates no WebKit stores and accesses no Keychain.

`cmake --build build-macos-arm64 -j4` checks native API compilation/linkage.

`node/test/fixtures/apps/session-behavior` exercises same-name localStorage
sharing (including concurrent windows), different-name isolation, user-agent
behavior, and macOS proxy rejection when run by the GUI fixture harness.
On older macOS it instead checks explicit rejection of named persistence.
It has not been run as part of this headless change. Persistence across process
restarts, actual old-OS execution, and WebKit cookie/storage behavior still need
platform integration testing. The fixture's unique names create durable WebKit
stores; no deletion/migration API is included here.
