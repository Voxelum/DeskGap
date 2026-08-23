# API Reference

::: info Work in Progress
For now most of the APIs listed below are linked to the Electron documentation pages respectfully.
Please be aware that they work similarly, but probably not exactly the same.
:::

## [app](https://electronjs.org/docs/api/app)

### Events

* [`ready`](https://electronjs.org/docs/api/app#event-ready)
* [`window-all-closed`](https://electronjs.org/docs/api/app#event-window-all-closed)
* [`before-quit`](https://electronjs.org/docs/api/app#event-before-quit)
* [`will-quit`](https://electronjs.org/docs/api/app#event-will-quit)
* [`quit`](https://electronjs.org/docs/api/app#event-quit)

### Methods

* [`quit()`](https://electronjs.org/docs/api/app#appquit)
* [`exit([exitCode])`](https://electronjs.org/docs/api/app#appexitexitcode)
* [`isReady()`](https://electronjs.org/docs/api/app#appisready)
* [`whenReady()`](https://electronjs.org/docs/api/app#appwhenready)
* [`getPath(name)`](https://electronjs.org/docs/api/app#appgetpathname) (supported names: `home`, `appData`, `temp`, `desktop`, `documents`, `downloads`, `music`, `pictures`, `videos`, `home`, `userData`)
* [`setPath(name, path)`](https://electronjs.org/docs/api/app#appsetpathname-path)
* [`getVersion()`](https://electronjs.org/docs/api/app#appgetversion)
* [`getName()`](https://electronjs.org/docs/api/app#appgetname)
* [`setName(name)`](https://electronjs.org/docs/api/app#appsetnamename)

## [BrowserWindow](https://electronjs.org/docs/api/browser-window)
### [`new BrowserWindow(options)`](https://electronjs.org/docs/api/browser-window#new-browserwindowoptions)

Supported `options` fields:

* `width`, `height`
* `x`, `y`
* `center`
* `minWidth`, `minHeight`, `maxWidth`, `maxHeight`
* `resizable`, `minimizable`, `maximizable`, `closable`
* `icon` (path string only)
* `frame`
* `title`
* `show`
* `autoHideMenuBar` (Windows and Linux)
* `backgroundMaterial` (Windows): framed windows support `auto`, `none`,
  `mica`, `acrylic`, and `tabbed`; frameless windows support `none` and
  composition-backed `acrylic`
* `vibrancy`
* `menu`
* `titleBarStyle` (supported values: `default`, `hidden`, `hiddenInset`)

### Instance Events

* [`ready-to-show`](https://electronjs.org/docs/api/browser-window#using-ready-to-show-event)
* [`page-title-updated`](https://electronjs.org/docs/api/browser-window#event-page-title-updated)
* [`blur`](https://electronjs.org/docs/api/browser-window#event-blur)
* [`focus`](https://electronjs.org/docs/api/browser-window#event-focus)
* [`move`](https://electronjs.org/docs/api/browser-window#event-move)
* [`resize`](https://electronjs.org/docs/api/browser-window#event-resize)
* [`close`](https://electronjs.org/docs/api/browser-window#event-close)
* [`closed`](https://electronjs.org/docs/api/browser-window#event-closed)

### Instance Methods

* [`destroy()`](https://electronjs.org/docs/api/browser-window#windestroy)
* [`close()`](https://electronjs.org/docs/api/browser-window#windestroy)
* [`minimize()`](https://electronjs.org/docs/api/browser-window#winminimize)
* [`isDestroyed()`](https://electronjs.org/docs/api/browser-window#winisdestroyed)
* [`show()`](https://electronjs.org/docs/api/browser-window#winshow)
* [`setSize(width, height[, animate])`](https://electronjs.org/docs/api/browser-window#winsetsizewidth-height-animate)
* [`getSize()`](https://electronjs.org/docs/api/browser-window#wingetsize)
* [`setMinimumSize(width, height)`](https://electronjs.org/docs/api/browser-window#winsetminimumsizewidth-height)
* [`setMaximumSize(width, height)`](https://electronjs.org/docs/api/browser-window#winsetmaximumsizewidth-height)
* [`setMenu(menu)`](https://electronjs.org/docs/api/browser-window#winsetmenumenu-linux-windows)
* [`setIcon(icon)`](https://electronjs.org/docs/api/browser-window#winseticonicon-windows-linux)
* [`setPosition(x, y[, animate])`](https://electronjs.org/docs/api/browser-window#winsetpositionx-y-animate)
* [`getPosition()`](https://electronjs.org/docs/api/browser-window#wingetposition)
* [`setTitle(title)`](https://electronjs.org/docs/api/browser-window#winsettitletitle)
* [`getTitle()`](https://electronjs.org/docs/api/browser-window#wingettitle)
* [`setAutoHideMenuBar(hide)`](https://electronjs.org/docs/api/browser-window#winsetautohidemenubarhide) (Windows and Linux)
* [`isMenuBarAutoHide()`](https://electronjs.org/docs/api/browser-window#winismenubarautohide) (Windows and Linux)
* [`setMenuBarVisibility(visible)`](https://electronjs.org/docs/api/browser-window#winsetmenubarvisibilityvisible) (Windows and Linux)
* [`isMenuBarVisible()`](https://electronjs.org/docs/api/browser-window#winismenubarvisible) (Windows and Linux)
* `setBackgroundMaterial(material)` (Windows; follows the same framed/frameless
	restrictions as the constructor option)
* [`loadFile(filePath)`](https://electronjs.org/docs/api/browser-window#winloadfilefilepath-options) (not supporting the `options` parameter)
* [`loadURL(url)`](https://electronjs.org/docs/api/browser-window#winloadurlurl-options) (not supporting the `options` parameter)

### Instance Properties

* `webView` (alias: [`webContents`](https://electronjs.org/docs/api/browser-window#winwebcontents))
* [`id`](https://electronjs.org/docs/api/browser-window#winid)


### Static Methods

* [`getAllWindows()`](https://electronjs.org/docs/api/browser-window#browserwindowgetallwindows)
* [`getFocusedWindow()`](https://electronjs.org/docs/api/browser-window#browserwindowgetfocusedwindow)
* `fromWebView(webView)` (alias: [`fromWebContents(webContents)`](https://electronjs.org/docs/api/browser-window#browserwindowfromwebcontentswebcontents))
* [`fromId(id)`](https://electronjs.org/docs/api/browser-window#browserwindowfromidid)

## `WebView` (alias: [WebContents](https://electronjs.org/docs/api/web-contents#class-webcontents))

### Instance Methods

* [`isDestroyed()`](https://electronjs.org/docs/api/web-contents#contentsisdestroyed)
* [`loadFile(filePath)`](https://electronjs.org/docs/api/web-contents#contentsloadfilefilepath-options) (not supporting the `options` parameter)
* [`loadURL(url)`](https://electronjs.org/docs/api/web-contents#contentsloadurlurl-options) (not supporting the `options` parameter)
* [`reload()`](https://electronjs.org/docs/api/web-contents#contentsreload)
* [`send(channel[, arg1][, arg2][, ...])`](https://electronjs.org/docs/api/web-contents#contentssendchannel-arg1-arg2-)

### Instance Properties

* [`id`](https://electronjs.org/docs/api/web-contents#contentsid)

### Frameless Window Regions

Use `data-deskgap-drag` for draggable custom title-bar regions and
`data-deskgap-no-drag` for interactive controls inside them. On WebView2,
frameless resize handles can declare one of eight native sizing directions:

```html
<div data-deskgap-resize="left"></div>
<div data-deskgap-resize="top-right"></div>
```

Supported values are `top`, `bottom`, `left`, `right`, `top-left`,
`top-right`, `bottom-left`, and `bottom-right`. The application controls each
handle's position, thickness, and resize cursor with CSS.

WebView2 custom title-bar buttons can bypass renderer/main-process round trips
and execute after pointer input completes:

```html
<button data-deskgap-window-control="minimize">Minimize</button>
<button data-deskgap-window-control="toggle-maximize">Maximize</button>
<button data-deskgap-window-control="close">Close</button>
```

These dedicated attributes are intended only for native frameless chrome.

## `Session`

Every WebView owns a Session. Use `session.defaultSession`,
`session.fromName(name)`, `session.fromPartition(partition)`, or
`session.createEphemeral()` to create or share one.

### Custom Protocols

Register custom application schemes before attaching the Session to a WebView:

```js
const browserSession = session.createEphemeral()

browserSession.protocol.handle('launcher-assets', async (request, context) => {
	return new Response(await readAsset(new URL(request.url)), {
		headers: { 'Content-Type': 'application/octet-stream' },
	})
})
```

Pages can then use the scheme with ordinary browser APIs and resource elements:

```js
const response = await fetch('launcher-assets://app/config.json')
```

`handle(scheme, handler)` returns a disposer. The protocol object
also provides `unhandle(scheme)` and `isProtocolHandled(scheme)`. Registrations
are Session-scoped and become immutable when the first WebView attaches.
Handlers receive a standard `Request` plus `{ session, signal }` and must return
a `Response`.

The portable contract uses authority-style URLs (`scheme://host/path`) and
supports `GET` and `HEAD`; other methods return 405. Responses are buffered up
to 64 MiB before crossing the native boundary. Built-in and DeskGap-reserved
schemes cannot be replaced. Cross-origin callers still require appropriate
CORS response headers. Custom schemes are not promised to be secure contexts.
WebView2, WKWebView, and WebKitGTK support custom protocols; WinRT rejects
Sessions that register them. Handler cancellation is delivered when the engine
reports a stopped request or when its WebView is destroyed; individual resource
abort notification is not available on every engine.

## `webViews` (alias: [`webContents`](https://electronjs.org/docs/api/web-contents))

### Methods

* `getAllWebViews()` (alias: [`getAllWebContents()`](https://electronjs.org/docs/api/web-contents#webcontentsgetallwebcontents))
* `getFocusedWebView()` (alias: [`getFocusedWebContents()`](https://electronjs.org/docs/api/web-contents#webcontentsgetfocusedwebcontents))
* [`fromId(id)`](https://electronjs.org/docs/api/web-contents#webcontentsfromidid)


## `messageUI` (alias: [`ipcRenderer`](https://electronjs.org/docs/api/ipc-renderer))

### Methods
* [`on(channel, listener)`](https://electronjs.org/docs/api/ipc-renderer#ipcrendereronchannel-listener)
* [`send(channel[, arg1][, arg2][, ...])`](https://electronjs.org/docs/api/ipc-renderer#ipcrenderersendchannel-arg1-arg2-)

## `messageNode` (alias: [`ipcMain`](https://electronjs.org/docs/api/ipc-main))

### Methods

* [`on(channel, listener)`](https://electronjs.org/docs/api/ipc-main#ipcmainonchannel-listener)

## [`dialog`](https://electronjs.org/docs/api/dialog)

### Methods

* [`showErrorBox(title, content)`](https://electronjs.org/docs/api/dialog#dialogshowerrorboxtitle-content)
* [`showOpenDialog(browserWindow, options, callback)`](https://electronjs.org/docs/api/dialog#dialogshowopendialogbrowserwindow-options-callback)
* [`showSaveDialog(browserWindow, options, callback)`](https://electronjs.org/docs/api/dialog#dialogshowsavedialogbrowserwindow-options-callback)

## [`shell`](https://electronjs.org/docs/api/shell)

### Methods

* [`shell.openExternal(url)`](https://electronjs.org/docs/api/shell#shellopenexternalurl-options-callback) (not supporting `options` and `callback`)
* `shell.writeShortcutLink(path, operation, details)` creates, updates, or
	replaces a Windows `.lnk` file.
* `shell.createDesktopShortcut(name, details)` creates or replaces a `.lnk`
	under the current user's Desktop directory.
* `shell.createStartMenuShortcut(name, details)` creates or replaces a `.lnk`
	under the current user's Start Menu Programs directory.

The high-level shortcut helpers are Windows-only and return `false` elsewhere.
The shortcut name must be a single file name; `.lnk` is appended when omitted.
`details.target` defaults to the current DeskGap executable and `details.cwd`
defaults to the target's directory. Supported details include `args`,
`description`, `icon`, `iconIndex`, `appUserModelId`, and
`toastActivatorClsid`.

## `externalWindow`

Native management of a visible top-level window owned by another process. This
replaces application-specific Koffi/FFI bindings with one bounded capability.

### Methods

* `isSupported()` returns `true` on Windows and macOS, and on Linux X11
	sessions. Wayland sessions return `false`.
* `moveAndResize(processId, bounds, options)` waits for a visible top-level
	window owned by `processId`, then moves and resizes it. `bounds` contains
	`x`, `y`, `width`, and `height`. `options.timeout` defaults to 15 seconds and
	accepts at most 300 seconds; `options.signal` cancels the wait. Call this
	method only after `app.whenReady()` resolves.

Windows bounds default to DeskGap display-independent coordinates and are
converted using the target monitor's effective DPI. Set
`options.coordinateSpace` to `screen` for physical pixels. macOS uses the
Accessibility API and may reject until the user grants accessibility
permission. Linux uses X11/EWMH and preserves the window's fullscreen state.
The API rejects with `ERR_EXTERNAL_WINDOW_NOT_FOUND`,
`ERR_EXTERNAL_WINDOW_UNSUPPORTED`, or a native movement error code.

## [`systemPreferences`](https://electronjs.org/docs/api/system-preferences)

### Methods

* [`isDarkMode()`](https://electronjs.org/docs/api/system-preferences) (available on macOS and Windows)

### Events

* `dark-mode-toggled` (available on macOS and Windows): will be emitted when the user turns on or turns off the system‘s dark mode. 

## `windowsAppInstaller`

Optional main-process integration with Windows App Installer. The API is
available on Windows 10 version 1809 and later. It does not load a separate
native addon and remains safe to import on every platform.

### Methods

* `isSupported()` returns whether the operating system supports the complete
	API surface.
* `getPackageIdentity()` resolves package `name`, `familyName`, `fullName`,
	`publisherId`, `version`, and the associated `appInstallerUri`. It returns
	`null` for an unpackaged process. `appInstallerUri` is `null` when the
	package was not installed through an App Installer file.
* `checkForUpdates()` resolves to `unknown`, `no-updates`, `available`,
	`required`, or `error`. It rejects when the current process has no package
	identity.
* `install(uri, options)` installs or updates from an HTTPS or local `file:`
	App Installer URI. `options.signal` cancels the Windows deployment operation;
	`options.onProgress` receives an object with `state` (`queued` or
	`processing`) and numeric `percent` fields.
	The optional `installAllResources`, `forceTargetApplicationShutdown`,
	`requiredContentGroupOnly`, and `limitToExistingPackages` flags map directly
	to Windows deployment options.

Native failures reject with an Error whose `code` is an HRESULT string such as
`HRESULT_0x80073D54` and whose numeric `hresult` field preserves the signed
Windows error value. Installation still enforces package signatures,
certificates, publisher identity, dependencies, and system policy through the
Windows deployment service.
