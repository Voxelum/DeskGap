# Desktop API and Electron Compatibility

DeskGap is not an Electron reimplementation. It should provide a small,
pleasant desktop API first and offer Electron-compatible names where doing so
is inexpensive and does not weaken semantics or security. Compatibility must
not weaken the boundary between the Node thread and untrusted web content.

This plan is based on Electron usage in x-minecraft-launcher, especially its
main-process controllers, preload modules, service RPC, task RPC, session
management, and multiplayer message ports. The concrete API inventory below
was audited against local x-minecraft-launcher branch `refactor/together` at
commit `98b3c71650137ed2cbb9d902b6a0cf2f29447026`. Imported but unused Electron
symbols are not treated as launcher requirements.

## Design Rules

* Prefer an easy, typed API with cancellation and streaming over Electron's
  channel-oriented IPC API. Electron aliases can be added on top where useful.
* Match Electron names, argument shapes, return values, and events only when
  the underlying behavior can be implemented consistently.
* Report unsupported behavior explicitly. Do not silently accept an option and
  provide weaker security or different persistence semantics.
* Keep Node.js and native modules in the Node thread. Renderer code receives
  only explicitly published capabilities.
* Treat every renderer message as untrusted input, including messages from a
  window that initially loaded local content.
* Every webview belongs to exactly one explicit session. Windows share the
  default persistent application session unless the application requests an
  isolated or differently named session.
* Treat native file paths from a user file drop as a required capability, not
  as optional Chromium compatibility.
* Dialog, shell, application lifecycle, tray, image, notification, and power
  APIs are required baseline desktop functionality.
* Prefer platform-native facilities, as Yue does, instead of copying APIs that
  depend on Chromium internals.

## Launcher Requirements

Current x-minecraft-launcher usage gives us a smaller target than Electron's
complete API surface:

* Drag and drop iterates `DataTransfer.files`, calls
  `webUtils.getPathForFile(file)`, ignores an empty result, and passes the
  native paths to resource and instance import services. It does not need an
  Electron-specific drag event.
* Most IPC is request/response controller and service traffic. The session
  protocol path already converts streamed Fetch `Request` and `Response`
  bodies to Node streams and propagates cancellation.
* `MessageChannelMain` is used for one long-lived, bidirectional multiplayer
  connection between two webviews, with requests, responses, and events.
* Sessions are persistent, selected by hostname, and configured with a shared
  user agent and proxy. Extensions from the default session are copied when
  the engine supports them.
* Application integration uses command-line switches, system locale, path
  overrides, relaunch, deep links, second-instance activation, window creation
  events, and the Windows application user model ID.
* Window management uses hidden, modal, transparent, frameless, and
  session-specific windows. Launcher controls require visibility, focus,
  minimize, maximize, restore, fullscreen, flashing, aspect ratio, and lookup
  from web contents.
* Web contents require navigation and popup policy, load failure and renderer
  crash events, find-in-page, explicit DevTools control, and access to the
  owning session. Chromium debugger and tracing support are diagnostic-only.
* The launcher writes text and images to the clipboard, enumerates displays,
  requests microphone and accessibility permissions, shows desktop
  notifications, observes battery power, creates Windows shortcuts, and stores
  credentials with Electron `safeStorage` today.
* The Windows launcher optionally loads `@xmcl/windows-utils` for packaged-app
  identity and App Installer updates. DeskGap exposes those operations directly
  through its built-in `windowsAppInstaller` API, so migration does not require
  a separately compiled Node addon.
* Launcher monitor selection bundles Koffi to call Win32, macOS Accessibility,
  and X11 APIs. DeskGap exposes the audited high-level operation as
  `externalWindow.moveAndResize()` instead of exposing arbitrary native FFI.
  Windows desktop and Start Menu `.lnk` creation is available directly through
  `shell.createDesktopShortcut()` and `shell.createStartMenuShortcut()`.

## Audited Non-IPC API Surface

The following list excludes `contextBridge`, `ipcMain`, `ipcRenderer`, service
and task RPC, `MessageChannelMain`, and transferred message ports. Those are
covered by the browser client, services, and channel design elsewhere in this
document.

### Portable Baseline

These APIs are either directly portable or have a clear platform-native
implementation. Electron-compatible names are useful where the semantics
match.

* `app`: `getSystemLocale`, `relaunch`, `browser-window-created`, and the
  Electron `exe` and `logs` path names are implemented. Windows
  `setAppUserModelId` is implemented with no-op behavior on other platforms.
  `commandLine.hasSwitch`, `getSwitchValue`, `appendSwitch`, and `removeSwitch`
  are implemented; appended switches configure Windows WebView2 browser
  arguments before its environment is created. macOS `open-url`, `activate`,
  and a platform-guarding `dock` object with show/hide/visibility are
  implemented. Keep the existing `whenReady`, `quit`, `exit`,
  `before-quit`, `window-all-closed`, single-instance, locale, and path APIs.
  A macOS `dock` surface is required only for the operations the launcher uses.
* `BrowserWindow`: `hide`, `focus`, `restore`, `maximize`, `unmaximize`,
  `isMaximized`, `isMinimized`, `isVisible`, `isFocused`, mutable
  `maximizable`/`minimizable`, fullscreen get/set, state lifecycle events,
  `flashFrame`, `setAspectRatio`, `getNativeWindowHandle`, and
  `fromWebContents` are implemented. Parent and modal windows are implemented
  with native owner/transient relationships. Support the portable parts of `transparent`,
  `useContentSize`, `autoHideMenuBar`, `hasShadow`, `backgroundMaterial`, and
  `trafficLightPosition`. Unsupported options must fail explicitly per engine.
* `webContents`: main-frame navigation start, redirect, successful finish, and
  failure events are implemented across native engines; failure no longer
  emits `did-finish-load`. The legacy WinRT engine reports navigation starts
  but cannot reliably classify redirects; WebView2, WKWebView, and WebKitGTK
  report them explicitly. Cancellable `will-navigate`/`will-redirect`, secure
  default-deny `setWindowOpenHandler`, controlled child-window creation,
  `did-create-window`, `render-process-gone`, portable `findInPage`/
  `stopFindInPage`, explicit DevTools methods, and the owning Session are
  implemented. Add portable `console-message` forwarding. A stable `id` and
  destruction checks already exist. WebView2 and WinRT cancel page navigation
  before asking Node and replay an allowed URL, so page-initiated POST bodies
  cannot be preserved; Launcher link navigation is GET-only.
* `session`: `defaultSession`, named persistent sessions, ephemeral sessions,
  Electron-compatible `fromPartition`, `setUserAgent`, and `setProxy` are
  implemented. Every WebView exposes its owning Session and BrowserWindow
  accepts one through `webPreferences.session`. Session configuration is frozen
  when the first WebView attaches so one storage directory cannot be opened
  with conflicting browser-process arguments. Extension enumeration and
  loading remain best effort and must report unsupported engines.
* `screen`: `getPrimaryDisplay` and `getAllDisplays` provide display `id`,
  `label`, `bounds`, `workArea`, `size`, `workAreaSize`, and `scaleFactor` on
  all three platforms.
* `clipboard`: text read/write and native-image writes are implemented on all
  three platforms. Windows publishes both PNG and `CF_DIBV5` image formats.
* `Notification`: title, body, icon, silent delivery, `show`, `click`, `close`,
  and `failed` are implemented. Windows uses ToastGeneric and requires
  `app.setAppUserModelId` plus the normal installed application identity;
  per-notification PNG icons are limited to five MiB and written to a temporary
  file. macOS
  uses UserNotifications with race-safe authorization cancellation and image
  attachments. Linux uses `GNotification` and per-notification app actions;
  notification servers do not expose a portable callback for passive user
  dismissal, so GTK guarantees `close` for activation and explicit close.
* `systemPreferences`: asynchronous microphone/camera permission requests and
  the macOS accessibility trust query used by the launcher are implemented.
  Unsupported permission categories are reported rather than treated as
  granted.
* `powerMonitor`: `onBatteryPower` and Electron-compatible
  `isOnBatteryPower()` are implemented with Win32, IOKit, and UPower backends.
  Portable `suspend`, `resume`, `on-ac`, and `on-battery` events use native
  power notifications on all three platforms.

### Existing Partial Parity

These areas already cover most launcher behavior and should be completed with
small compatibility additions rather than replaced.

* `dialog`: open, save, error, and asynchronous message dialogs exist. Message
  boxes support `checkboxLabel`, initial `checkboxChecked`, and Electron result
  objects on all three platforms.
* `shell`: `openExternal`, `openPath`, and `showItemInFolder` exist.
  `writeShortcutLink` supports `create`, `update`, and `replace` plus Windows
  `ShortcutDetails`; it explicitly returns `false` on non-Windows platforms.
* `Tray` and `Menu`: image, context menu, click, double-click, and destruction
  behavior exist. Electron's `setToolTip` spelling aliases the original
  `setTooltip`; popup and event behavior still needs cross-platform validation.
* `nativeTheme`: mutable `themeSource` and `shouldUseDarkColors` already cover
  current launcher use. Preserve change notification semantics.
* `nativeImage`: buffer and path construction plus image conversion already
  cover current launcher use. Clipboard and notification APIs should accept
  this existing image value.

### Adapters and Explicit Non-Goals

Some launcher dependencies cannot or should not be implemented as exact
Electron APIs:

* `webUtils.getPathForFile(File)` must be replaced by the scoped native-drop
  API described below. It must not accept arbitrary browser `File` objects.
* `session.protocol.handle("http"|"https")` and
  `net.fetch({ bypassCustomProtocolHandlers: true })` currently implement the
  launcher's asset and network routing. Managed assets and application services
  must migrate to stable application origins and DeskGap service routes.
  General HTTP/HTTPS interception remains engine-specific.
* Electron-only `webPreferences`, including renderer preload,
  `contextIsolation`, `sandbox`, `webviewTag`, `additionalArguments`, and
  Chromium extension assumptions, are not portable contracts. DeskGap should
  expose the corresponding capability only where its browser-client security
  model gives equivalent semantics.
* Electron `safeStorage` is synchronous encryption of arbitrary strings. The
  DeskGap baseline remains the asynchronous account-oriented credential API
  below. A launcher adapter may preserve its storage format during migration,
  but DeskGap must not silently fall back to plaintext.
* `contentTracing` and `webContents.debugger.sendCommand` are Chromium
  diagnostics. They remain optional engine-specific APIs and must not be
  required for normal launcher operation.
* The launcher uses the external `electron-updater` package. Updating is an
  application integration concern rather than an Electron core parity promise;
  DeskGap still needs a documented check, download, install, and relaunch path
  before the launcher can migrate completely.
* `globalShortcut` and `powerSaveBlocker` are not currently used by the audited
  launcher revision and are not compatibility blockers.

## Browser Client and Services

Electron preload scripts run in a Chromium renderer with privileged Electron
bindings. With context isolation, Electron can expose selected values from that
privileged world to the page. A system webview does not provide a portable Node
runtime, Node native-module loader, or equivalent isolated world. Reproducing
Electron preload exactly is therefore not realistic.

DeskGap will provide a safer portable alternative using ordinary browser APIs:

1. An application imports the DeskGap browser client as a normal JavaScript
  module from its loopback HTTP origin. The native webview does not inject a
  preload or messaging bridge.
2. The client can import other browser modules at build time, but cannot use
  Node.js or load `.node` modules.
3. The Node thread registers named services and capabilities for each window
   or session.
4. The client exposes only those services granted to the window. The primary
  service API
   uses Fetch-compatible requests and responses, including `ReadableStream`,
   `AbortSignal`, headers, status, structured errors, and binary bodies.
5. Navigation invalidates the old connection identity. The server derives the
  sender window and navigation generation from its bearer token rather than
  trusting fields supplied by the page.

The primary API shape is intentionally smaller than Electron IPC:

* Node: register a handler such as
  `webView.handleService("launcher", (request, context) => Response)`.
* Browser client: call
  `window.deskgap.fetch("service://launcher/path", options)`.
* Small JSON command calls use
  `webView.handle("launcher.install", (context, args) => result)` and
  `window.deskgap.invoke("launcher.install", args, { signal })`.
* Events and long-lived duplex traffic use a separate channel abstraction;
  they are not encoded as fake request/response calls.
* Applications publish browser-visible APIs from the main thread rather than
  running privileged renderer code.

`handle()` and `invoke()` are an ergonomic adapter over the same authenticated
HTTP service transport, not another WebSocket RPC protocol. Handlers are scoped
to one WebView, reject duplicate names, and receive the server-derived window
ID, navigation generation, cancellation signal, owning WebView, and native-file
handle resolver. The renderer cannot supply this identity. Calls and responses
are limited to one MiB of JSON-compatible values. Remote failures preserve
`name`, `message`, and optional JSON-compatible `code` and `details`, but never
copy a remote stack into the renderer. A disposer or `removeHandler()` removes
a registration. `sendSync`, arbitrary renderer `require`, Electron `remote`,
and renderer-loaded native modules remain unsupported.

## WebviewJS Design Review

This comparison is based on WebviewJS 0.4.3 at commit
[`d6d94a4`](https://github.com/webviewjs/webview/commit/d6d94a4a30df9ab0d58d5d8269626066a1a8c4b9)
and Wry 0.55.1 at commit
[`a5bf203`](https://github.com/tauri-apps/wry/commit/a5bf203a1c8dbb3583588382538d6521655222a8).
It records implementation lessons rather than promising compatibility with
either project.

WebviewJS is a thin N-API addon. Node and Tao share one thread, and a Node timer
pumps the reusable Tao event loop every 16 ms by default. Its native IPC injects
`window.ipc.postMessage`, while its higher-level `expose()` API builds
Promise-based JSON RPC over that bridge. Custom protocol handlers use the
familiar Web Fetch shape: Node receives a `Request` and returns a `Response`.

DeskGap should adopt the simplicity of those public API shapes without adopting
the same underlying transport or event-loop model:

* Make `handleService()` accept and return standard Fetch objects directly, and
  keep the adapter small enough that routers such as Hono can provide their
  `fetch` handler without a DeskGap-specific wrapper.
* The implemented `handle()`/`invoke()` convenience API covers small
  command-style calls over the same scoped service transport, with structured
  errors, `AbortSignal`, size limits, and automatic invalidation on navigation.
* Present three public communication levels: `invoke()` for short RPC,
  `handleService()` for Fetch-shaped request/response work, and
  `TransportChannel` for long-lived or binary duplex streams. JSONTalk,
  WebSocket framing, and any native bootstrap path are implementation details.
* Allow services and capabilities to be declared while creating a window, so
  the common case does not require applications to assemble transport pieces.
  Keep origin, window, and navigation-generation ownership explicit and
  auditable.
* Keep native bindings on public N-API where practical and concentrate Node
  embedder-version dependencies in a small runtime layer. DeskGap remains a
  bundled application runtime, but upgrading its bundled Node should not force
  changes to application-facing APIs.
* Teach the API progressively: create a window, expose a command, register a
  Fetch service, open a binary channel, and then configure permissions for
  remote content. Applications should not need to understand tickets or frame
  formats before using the safe defaults.

The source review also establishes limits that DeskGap must not copy or obscure:

* Do not replace the native main-thread GUI loop with timer-driven pumping on
  the Node thread. The separate UI thread keeps native window processing alive
  during a long Node callback and avoids continuous idle timer wakeups. Its
  cross-thread dispatch cost is an accepted tradeoff.
* Do not replace `TransportChannel` with string IPC. Explicit frame bounds,
  bounded receive queues, and credit returned as the consumer reads are needed
  for predictable memory use under slow consumers.
* A Fetch-shaped custom protocol API does not prove end-to-end streaming.
  WebviewJS currently materializes a response with `arrayBuffer()` before
  handing it to Wry, and Wry buffers the corresponding custom-protocol bodies.
  Wry's Linux request-body support additionally requires its `linux-body`
  feature, which WebviewJS 0.4.3 does not enable. DeskGap should preserve real
  loopback HTTP streams and cancellation behind its Fetch-shaped API.
* Do not use a rewritten custom scheme as the application identity. On Windows,
  Wry maps a URL such as `app://localhost/path` to an HTTP(S) URL and handles it
  through WebView2 `WebResourceRequested`. DeskGap's stable per-application host
  is the better basis for storage, CSP, Fetch, and origin policy.
* Do not expose convenient RPC globally. WebviewJS injects its IPC bridge into
  loaded pages and leaves origin authorization to the application. DeskGap
  must deny remote or otherwise untrusted pages a privileged token or fallback
  bridge by default.

The implementation priority derived from this review is:

1. Remove the unrestricted native fallback from remote and untrusted pages,
   then test revocation across navigation and web-process replacement.
2. Complete the Fetch-native `handleService()` surface and router adapters while
   retaining streamed bodies and cancellation.
3. Keep the capability-scoped `handle()`/`invoke()` adapter bounded and add
  timeout helpers only if applications need policy beyond `AbortSignal`.
4. Consolidate the public communication model around RPC, services, and
   channels, then simplify window setup and the task-oriented documentation.

The design principle is to borrow WebviewJS's Web-standard, low-ceremony API
surface while retaining DeskGap's separate GUI loop, authenticated navigation
identity, real streaming, and bounded backpressure.

## Native Webview IPC Limits

The three native APIs have materially different ceilings. DeskGap's current
string-only bridge is below those ceilings, but upgrading it does not produce a
portable binary or streaming transport.

| Platform | Practical native capability | Limit that affects DeskGap |
| --- | --- | --- |
| Windows WebView2 | JSON/string messages in both directions, source URI, per-frame message handlers, document-start injection, and host-to-script shared buffers on a sufficiently new runtime | DeskGap pins the old `1.0.1072.54` SDK and currently reads strings only. Shared buffers require API/runtime support introduced with SDK `1.0.1661.34`, are WebView2-specific, and are not a portable stream |
| macOS WKWebView | Property-list messages, asynchronous replies, sender `WKFrameInfo`, named `WKContentWorld`, and document-start scripts | Message and async-call values are limited to numbers, strings, dates, arrays, dictionaries, and null. There is no public ArrayBuffer, transferable port, or native stream bridge; host-initiated events still require JavaScript evaluation or another transport |
| Linux WebKitGTK 4.1 | WebKitGTK 2.40 provides `JSCValue` messages with asynchronous replies, named script worlds, and custom URI requests with method, headers, body, and streamed responses | Public script-message callbacks do not identify the sending frame or origin. Host-to-page delivery still requires JavaScript evaluation, and portable binary transfer is not guaranteed |

These APIs are not needed by the target transport. Keeping a native message
bridge only for bootstrap would add three security-sensitive implementations
without improving the public API. If a future platform-specific feature uses
one internally, it must remain an optimization and cannot become a browser
capability or portability requirement. Native webview messaging cannot honestly
promise all of the following across the three engines:

* zero-copy or structured-clone binary values;
* a native `ReadableStream` or `WritableStream` with backpressure;
* transferable DOM `MessagePort` objects;
* reliable identity and routing for arbitrary child frames on GTK;
* synchronous calls or ordering relative to unrelated DOM and navigation
  events.

Windows shared buffers and Linux streamed custom schemes remain worthwhile
platform optimizations, but must not change public behavior.

## Transport Decision

Do not expose a native webview message bridge. Use one loopback HTTP/WebSocket
server per DeskGap process on a random port. Serve application UI assets from a
stable, application-specific local origin so `localStorage` and IndexedDB remain
available across launches. The UI uses Fetch and one long-lived WebSocket to
the loopback transport for services, events, channels, and multiplexed duplex
streams.

1. Start an HTTP/WebSocket server bound only to loopback before creating the
  managed application webview.
2. Create a cryptographically random, single-use window ticket and navigate the
  webview to an application URL carrying it in the URL fragment. Fragments are
  not sent in HTTP requests. The browser client reads and immediately removes
  the ticket from the visible URL with `history.replaceState`.
3. Load managed UI assets from the stable application origin. HTTP service
  routes on the random loopback port provide real Fetch response streams and
  cancellation without encoding body chunks as native webview messages. The
  server permits only the exact application origin through CORS.
4. The browser client exchanges the single-use ticket over HTTP for a scoped,
  short-lived bearer token and transport metadata. Service Fetch requests carry
  that token in `Authorization`. Store it only in the top-level window's
  `sessionStorage` so an ordinary reload can reconnect without sharing identity
  with another window; never put it in cookies, `localStorage`, or persistent
  application storage.
5. The client opens a WebSocket to the random loopback port. The server validates
  `Host` and the exact stable application `Origin` and requires the bearer token
  in the first protocol frame. A native
  navigation event revokes the token and closes the old socket; it does not
  send a message into the page.
6. One versioned framing protocol multiplexes events, channels, native file
  handles, and binary duplex stream chunks over the socket. HTTP request
  cancellation propagates through `AbortSignal`. Normal
  WebSocket reconnect handles transient disconnects. After a web-process crash,
  the native host revokes the old identity and navigates the replacement process
  to a fresh ticket URL; it does not call into page JavaScript.

The stable application origin is separate from the random transport origin.
Windows should use a WebView2 virtual host mapping; macOS and Linux should use
their registered application scheme. The origin must include a stable per-app
identifier so unrelated DeskGap applications cannot share browser storage. The
transport port is free to change on every launch because no persistent browser
state belongs to its origin. Cookies are scoped by host rather than port, but
DeskGap bearer tokens must not use cookies.

WebSocket provides portable full-duplex binary frames, but the browser
`WebSocket` API does not provide receive backpressure. DeskGap must add it at
the protocol layer: each logical stream has a bounded byte window, the sender
may transmit only granted credit, and the receiver grants more credit as its
`ReadableStream` is consumed. `bufferedAmount` is useful for limiting browser
send queues but is not sufficient by itself. The non-standard
`WebSocketStream` API cannot be used because WKWebView and WebKitGTK do not
provide it consistently.

DeskGap must emit explicit CSP `connect-src` entries for the random HTTP and
WebSocket origins. The release gate must cover CORS, mixed-content rules,
Chromium Local Network Access, proxies, and endpoint security on all three
engines. Remote pages must not receive an unrestricted service token and have
no privileged fallback bridge. Applications that need remote content embed it
as unprivileged content inside a DeskGap-managed shell.

The service API remains Fetch-compatible. A future implementation may use
WebView2 shared buffers internally for selected local bulk transfers, but this
must not change `window.deskgap.fetch` or require page-visible native messaging.

Before committing this as the production transport, a native spike must run on
WebView2 with Local Network Access checks enabled, macOS 13.5 WKWebView, and both
WebKitGTK 2.40 and a current WebKitGTK release. It must cover reload/token
revocation, CSP, binary traffic in both directions, concurrent streams,
cancellation, a deliberately slow consumer, web-process restart, and occupied
ports. It must test each stable application origin connecting to a random
loopback HTTP/WebSocket port. The acceptance criteria are persistent
`localStorage` and IndexedDB across launches, no permission prompt for managed
application content, bounded memory under backpressure, and automatic reconnect
without replaying non-idempotent requests.

## Native Dropped Files

The native layer captures file and directory drops and the Node WebView creates
cryptographically random handles scoped to the receiving window and navigation.
The browser client receives a `files-dropped` event over its authenticated
WebSocket through `window.deskgap.onFilesDropped(listener)`. Each entry contains
only `handle`, `name`, `kind`, and `size`; native paths never enter browser
content. A service resolves a handle with `context.resolveFileHandle(handle)`.
Handles expire after five minutes, are revoked by navigation or destruction,
and are bounded to 256 active capabilities per WebView.

WebView2, WKWebView, and WebKitGTK provide native paths to the host drop
callback. The legacy WinRT WebView does not expose native paths for DOM `File`
objects and therefore reports this capability as unsupported; it must not
fabricate paths from browser metadata.

Without a page-visible native bridge, Electron's synchronous
`webUtils.getPathForFile(file)` cannot be reproduced faithfully: browsers do not
expose a native path on `File`, and matching a native drop to DOM `File` objects
by name and size is unsafe. The launcher adapter should consume DeskGap's native
drop event instead. An optional compatibility helper may expose path strings on
the DeskGap drop entries for fully trusted managed applications, but it must not
claim to accept arbitrary browser `File` objects.

## Sessions and Protocols

Every webview has one session. The default is a persistent application session
shared by all windows and across launches. Applications can request a named
persistent session or a new ephemeral session; the same persistent name always
resolves to the same session. This provides deterministic sharing without
requiring Electron's partition syntax.

`BrowserWindow` accepts a `Session` instance. Passing the same instance shares
cookies, cache, storage, proxy, and user agent; passing another instance
isolates them. Omitting it uses `session.defaultSession`. Convenience factories
such as `session.fromName(name)` and `session.createEphemeral()` avoid exposing
Electron's `persist:` naming convention.

The initial implementation supports persistent folders, ephemeral folders,
custom user agents, and per-session proxy arguments on WebView2. WebKitGTK 2.40
uses one shared `WebKitWebContext` and data manager per Session. macOS 13.5 can
share the default persistent store or an in-memory store per ephemeral Session,
but cannot create isolated named persistent `WKWebsiteDataStore` instances and
does not expose per-session proxy configuration. WinRT rejects non-default
sessions, user-agent overrides, and proxies explicitly. Session configuration
must be completed before the first WebView attaches.

User agent and proxy configuration are required session features. Listing and
loading browser extensions are best effort because not every system webview
supports them; unsupported engines must report that explicitly.

Full HTTP/HTTPS interception is not a portable promise. The portable path is
the main-controlled service router described above, plus custom application
schemes where an engine supports streamed responses. A lightweight,
service-worker-like browser adapter may route selected application requests to
`service://` handlers without giving the page arbitrary network interception.
Actual service-worker installation or HTTP/HTTPS interception remains an
engine-specific optimization.

## Channels and Message Ports

DeskGap provides `TransportChannel` endpoints over the authenticated WebSocket.
Node creates an endpoint with `webView.createChannel()` and browsers receive it
through `window.deskgap.onChannel(listener)`; browsers can create the reverse
direction with `window.deskgap.createChannel()`. Each endpoint exposes binary
`ReadableStream&lt;Uint8Array&gt;` and `WritableStream&lt;ArrayBuffer | ArrayBufferView&gt;`
surfaces plus close events.

The main thread can connect endpoints from two WebViews with
`bridgeChannels(first, second)`. The broker pipes both directions and
coordinates shutdown without exposing native or DOM transferable ports.

Each direction starts with 256 KiB of credit. Data is split into bounded binary
frames, the writer blocks when credit is exhausted, and credit is returned only
when the peer's `ReadableStream` consumes a chunk. Channel IDs use disjoint odd
and even namespaces for Node and browser creation. Invalid credit, unknown
channels, receive-window overflow, and malformed binary frames close the
transport or channel explicitly.

Transient WebSocket disconnects reconnect with capped exponential backoff and
reuse the scoped bearer token. Frames already submitted to the old socket are
never replayed. JSONTalk messages created while disconnected are queued within
the one MiB transport bound, while all channels close with a disconnect reason
and must be re-created by the application. This prevents replaying multiplayer
TCP bytes or other non-idempotent channel data.

If this abstraction maps cleanly to DOM `MessagePort`, expose
`MessageChannelMain` and transferred ports as compatibility adapters. If not,
the launcher multiplayer bridge can use the DeskGap channel directly without
changing its request/response/event protocol.

## Credential Storage

Credential storage should follow keytar's service/account model rather than
Electron `safeStorage`. The minimum asynchronous API is
`credentials.getPassword(service, account)`,
`credentials.setPassword(service, account, password)`,
`credentials.deletePassword(service, account)`, and
`credentials.findCredentials(service)`.

Implementations use Keychain on macOS, Credential Manager protected by DPAPI
on Windows, and Secret Service on Linux. If no secure backend is available,
calls fail explicitly instead of writing plaintext or silently falling back to
application-managed encryption.

This API is implemented as `credentials`. Its four operations run on N-API
workers so Keychain unlock and Secret Service interaction do not block the Node
event loop. Windows stores generic credentials with encoded service/account
targets, macOS uses generic-password Keychain items, and Linux uses a libsecret
schema with service/account attributes. No backend falls back to files or
plaintext storage. Service names are prefixed with a hash of the DeskGap
application ID so unrelated applications cannot read or replace each other's
same-named credentials. Native worker password copies are wiped after each
Promise settles.

## Application Updater

DeskGap provides an application-level `Updater` rather than copying
`electron-updater` packaging assumptions. `checkForUpdates(manifestURL)` reads a
bounded JSON manifest and requires an application-configured Ed25519 public
key. Release tooling signs the canonical payload returned by
`serializeUpdateManifestForSignature()`. Each platform/architecture asset must
declare a safe filename, exact byte size, and SHA-256 digest.

Manifest and asset URLs require HTTPS. Loopback HTTP is available only through
an explicit development option. Redirects are followed manually for at most
five hops and every origin must match the manifest origin or an explicit
allowlist. `downloadUpdate()` accepts only frozen metadata returned by the same
Updater after signature verification. It streams to an exclusive random
partial file, reports progress, propagates `AbortSignal`, enforces a four GiB
maximum, verifies size and SHA-256, and atomically publishes the artifact.
Concurrent writes to one artifact path are rejected.

`install()` accepts only artifacts downloaded and verified by that Updater.
Legacy assets and assets with `type: "runtime"` are verified again, copied to a
private staging directory, and launched through a fixed platform installer
mapping: Windows EXE/MSI, macOS PKG/DMG through `/usr/bin/open`, Linux
AppImage, or DEB/RPM through `/usr/bin/xdg-open`. Remote manifests cannot
provide commands or arguments. Installer success after handoff remains the
responsibility of the platform package manager.

Assets with `type: "application"` use the portable application payload format
instead. They must declare `format: "tar.zst"`, `requiredRuntimeApi`, and the
exact `unpackedSize`. The updater streams Zstd decompression into a bounded tar
extractor that accepts only regular files and directories and rejects links,
path traversal, duplicate paths, reserved names, and platform-ambiguous paths.
It extracts once into a SHA-256-addressed user-data directory, writes a
completion marker, and atomically updates `active.json`. Startup uses that
payload only when both records are complete and otherwise falls back to the
embedded `resources/app`. `quitAndInstall()` relaunches after activating an
application payload; `install()` leaves activation for the next launch.

### Windows App Installer

`windowsAppInstaller` uses `Package.Current`,
`CheckUpdateAvailabilityAsync`, and
`PackageManager.AddPackageByAppInstallerFileAsync` through C++/WinRT. No extra
native dependency is loaded. It reports support on Windows 10 version 1809 and
later, returns `null` package identity for unpackaged processes, exposes the
current App Installer URI when one exists, maps update availability to stable
string names, and supports deployment progress plus `AbortSignal`
cancellation.

HTTPS and local `file:` URIs are accepted; insecure remote HTTP is rejected
before native deployment. HRESULT failures retain both a stable hexadecimal
`code` and the signed numeric `hresult`. Unpackaged behavior is covered by a
native runtime fixture. Identity, update availability, and installation still
require validation in an actual signed MSIX/AppX CI fixture.

`npm run package:application -- {source} {output.tar.zst} [version]` creates a
deterministic Zstd level 10 payload and adjacent `.metadata.json` containing the
asset fields for the signed manifest. The standard Node build emits the same
artifact next to the packaged runtime while retaining the embedded app as the
recovery copy.

### Application Storage

DeskGap derives the storage directory name once from the embedded build's
`productName`, falling back to `name` and then `DeskGap`. Application payload
updates and `app.setName()` cannot change this identity. `app.getPath()` splits
configuration from machine-local state as follows:

| Path | Windows | macOS | Linux |
| --- | --- | --- | --- |
| `userData` | `%APPDATA%/{App}` | `~/Library/Application Support/{App}` | `$XDG_CONFIG_HOME/{App}` |
| `localData` | `%LOCALAPPDATA%/{App}` | `~/Library/Application Support/{App}` | `$XDG_DATA_HOME/{App}` |
| `sessionData` | `{localData}/Sessions` | `{localData}/Sessions` | `{localData}/Sessions` |
| `cache` | `%LOCALAPPDATA%/{App}/Cache` | `~/Library/Caches/{App}` | `$XDG_CACHE_HOME/{App}` |

The Node compile cache uses `{cache}/NodeCompileCache`, persistent WebView
sessions use `sessionData`, and downloaded update artifacts use
`{localData}/updates`; logs use `{localData}/Logs`. On Windows, activated application payloads live under
`%LOCALAPPDATA%/Programs/{App}/application/payloads/{sha256}`; macOS and Linux
place the same content-addressed tree under `{localData}/application`. The
runtime executable remains in its original installer, portable, application
bundle, or package-manager location.

### Windows Click-To-Run

The Windows build also produces a self-extracting executable using the
`DeskGapBootstrap` target. Its append-only container is:

```text
DeskGapBootstrap.exe
runtime.tar.zst
application.tar.zst
application identity and per-file SHA-256 manifest
DGCLK001 footer
```

The footer records both compressed payload sizes and SHA-256 digests. The
bootstrap verifies those digests, extracts each payload through the bundled
Zstd decoder into a temporary directory, verifies every extracted file against
the embedded manifest, and atomically publishes the content-addressed runtime
and application directories. Every later launch verifies the installed files
and extracts again only when content is missing or changed. Concurrent launches
are serialized with an application-specific Windows mutex, and original command
line arguments are forwarded to the extracted runtime.

`npm run package:click-to-run -- {bootstrap.exe} {runtime-directory}
{application-directory} {output.exe} {version} [runtime-entry]` creates the
container. `node/scripts/build.sh` invokes it automatically for Windows. The
packager injects `resources/app-identity.json` into the runtime archive so an
external application payload cannot change its storage identity and does not
need to be duplicated inside the runtime payload.

Authenticode signing must run after click-to-run packaging. Signing may append
the PE certificate table after the DeskGap footer; the bootstrap searches for
and validates the footer rather than assuming it is the final bytes of the
signed executable.

## Launcher Compatibility Matrix

| Area | x-minecraft-launcher usage | DeskGap today | Target | Priority |
| --- | --- | --- | --- | --- |
| Services and browser bridge | `contextBridge`, request/response IPC, service and task channels | Per-WebView `handle()` plus renderer `invoke()` over authenticated loopback HTTP with trusted context, cancellation, structured errors, and 1 MiB JSON limits; Fetch services, binary channels, reconnect rules, strict v1 WebSocket envelopes, and legacy JSONTalk coexist | Port launcher controllers to invoke/Fetch and remove legacy JSONTalk after migration | P0 |
| Native file drop | `webUtils.getPathForFile` for resource, instance, image, and modpack imports | Scoped expiring native file handles are delivered over authenticated WebSocket events and resolved only by the owning service context | Adapt launcher drop handlers and add macOS/GTK/WebView2 manual drop coverage; exact `File`-object compatibility is not promised | P0 |
| `BrowserWindow` | Hidden/modal/session windows, custom chrome, transparency, focus and full window-state control | Construction including parent/modal/session, transparent windows, content sizing, shadow control where supported, Windows background material, macOS traffic-light position, visibility/focus, minimize/restore, maximize/unmaximize, fullscreen, state queries/events, flashing, aspect ratio, native handle, size/position, menu, title, icon, frame controls, vibrancy, and content lookup | Add auto-hide-menu behavior and validate transparency/shadows on macOS/GTK | P0 |
| `webContents` | Navigation and popup policy, load/crash events, find, DevTools, debugger, and session access | Load/reload, destruction state, ID, cancellable navigation and popup policy, controlled child windows, load/renderer/console lifecycle, find, explicit DevTools methods, title events, file drops, and owning session | Improve engine-specific DevTools behavior and keep debugger diagnostics optional | P0 |
| Session | One persistent session per site, optional sharing, proxy, user agent, extension list, `fetch` | Explicit owning Session, shared persistent default, named/ephemeral isolation, UA and proxy on WebView2/GTK, default/ephemeral stores plus UA on macOS, and streaming/cancellable main-process fetch with UA/fixed proxy; WinRT rejects unsupported configuration | Add extension APIs where supported and validate macOS/GTK behavior | P0 |
| Protocol and local services | Streamed Fetch interception for application assets and selected HTTP/HTTPS requests | Local file loading plus an initial main-controlled loopback service route | Complete streamed service routes and custom schemes; HTTP/HTTPS interception only where portable | P0 |
| Message ports | `MessageChannelMain` connects main UI and multiplayer core | Bidirectional `TransportChannel` with binary frames, Web Streams, 256 KiB credit backpressure, bounded queues, close semantics, and no replay across reconnect | Port the launcher socket bridge to channel streams; expose MessagePort-compatible adapters only if semantics remain honest | P1 |
| App lifecycle | Deep links, second instance, relaunch, command-line switches, system locale, path overrides, window creation, app ID, and macOS dock | Readiness, quit/exit, relaunch, command-line queries/appends, system locale, paths including `exe`/`logs`, protocol registration, window creation, app ID, single instance, macOS activation/open-URL, and dock visibility | Validate macOS lifecycle delivery and initial deep links; non-WebView2 engines do not consume Chromium switches | P1 |
| Dialog and shell | Promise dialogs, message-box checkbox, `openPath`, file reveal, external URLs, and Windows shortcuts | Promise file/message dialogs including checkboxes, error box, path/URL opening, file reveal, and Windows shortcut create/update/replace | Cross-platform validation and any remaining Electron option/result differences | P1 |
| External game windows | Koffi bindings move/resize a game window by PID through Win32, macOS Accessibility, or X11/EWMH | Built-in `externalWindow` waits for a visible process window, preserves fullscreen where required, supports Windows DIP conversion, timeout, cancellation, and explicit Wayland rejection | Validate macOS accessibility prompts and X11 window-manager behavior in platform CI | P1 |
| Screen and clipboard | Display enumeration and primary display; text and image clipboard writes | Public cross-platform display enumeration plus text read/write and native-image clipboard writes | Validate multi-monitor coordinates and clipboard interoperability on macOS/GTK | P1 |
| Theme and permissions | Mutable `nativeTheme`, microphone permission, accessibility trust | Mutable theme source/dark-mode observation, asynchronous microphone/camera requests, and accessibility trust queries | Validate permission prompts on macOS and add any future platform-specific categories explicitly | P1 |
| Images, tray, notifications | `nativeImage`, tray images/events, tooltip/context menu, desktop notifications | Portable native images, core tray/menu behavior, both tooltip spellings, and system notifications with image/lifecycle events | Validate notification and tray behavior on macOS/GTK and installed Windows application identities | P1 |
| Credential storage | Account secrets; Electron API compatibility is not required | Asynchronous keytar-style `credentials` backed by Credential Manager/DPAPI, Keychain, and libsecret Secret Service with explicit failures | Port the launcher safeStorage adapter and validate Keychain/Secret Service prompts in platform CI | P1 |
| Power | Current battery-power state; future suspend/resume integration | Public battery state plus `suspend`, `resume`, `on-ac`, and `on-battery` events backed by Win32, IOKit, UPower, and logind | Validate event delivery across platforms | P1 |
| Chromium tooling | Debugger protocol, tracing, and extensions | DevTools can be enabled, but there is no debugger/tracing API | Keep optional and platform-specific; these are not core compatibility promises | P3 |
| Updater integration | `electron-updater` check, download, cancellation, install, and relaunch flow | Signed application-level Updater with semver selection, platform assets, streaming progress/cancellation, size/hash checks, artifact provenance, staged installer launch, and explicit quit-and-install | Adapt launcher release metadata and installer packaging to the signed manifest; validate macOS/Linux handoff in platform CI | P2 |
| Windows App Installer | Optional `@xmcl/windows-utils` package identity, update availability, and App Installer deployment | Built-in optional `windowsAppInstaller` identity/update/install API with progress, cancellation, deployment flags, and structured HRESULT failures | Validate identity, update availability, and an actual signed `.appinstaller` deployment from an MSIX-packaged CI fixture | P2 |

## Delivery Order

1. Replace JSONTalk's implicit global endpoint with a versioned transport that
  uses a URL-fragment ticket, random-port loopback HTTP for streamed services,
  and an authenticated WebSocket for events, channels, binary data,
  cancellation, native file handles, and duplex-stream backpressure. Build the
  Fetch-compatible service router and ordinary browser client on it.
2. Add native dropped-file handles and port the launcher's controller,
   service, and task calls to the simpler service API. Add Electron IPC aliases
   only where they reduce migration work.
3. Add the explicit shared/named/ephemeral session model with user-agent and
   proxy control, then add custom schemes and the service-worker-like adapter.
4. Add the brokered duplex channel and validate it against the multiplayer
   bridge. Add MessagePort compatibility only if it maps without semantic gaps.
5. Complete window/webview lifecycle and session ownership, then add screen,
  clipboard, permissions, dialog checkbox support, shell shortcuts,
  application lifecycle, tray aliases, notifications, credential storage,
  and power APIs. These are baseline desktop APIs, not optional compatibility
  extras.
6. Port application release pipelines to the signed updater manifest and
  validate package-manager handoff. Keep Chromium debugger, tracing,
  HTTP/HTTPS interception, and extension support optional and engine-specific.

The first compatibility test application should exercise native multi-file
drop, streamed launcher services, cancellation, and shared-versus-isolated
sessions without Electron. Later tests should add the multiplayer channel and
engine-specific protocol interception.

## API References

* [WebView2 shared buffers](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2sharedbuffer)
* [WKScriptMessage](https://developer.apple.com/documentation/webkit/wkscriptmessage)
* [WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply)
* [WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld)
* [WebKitGTK script handlers with replies](https://webkitgtk.org/reference/webkit2gtk/stable/method.UserContentManager.register_script_message_handler_with_reply.html)
* [WebKitGTK custom URI requests](https://webkitgtk.org/reference/webkit2gtk/stable/class.URISchemeRequest.html)
* [WebSocket backpressure limitation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
* [CSP `connect-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src)
* [Potentially trustworthy loopback origins](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts#potentially_trustworthy_origins)
* [Chromium Local Network Access](https://developer.chrome.com/blog/local-network-access)