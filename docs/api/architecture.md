# Multi-Threading Architecture

DeskGap starts Node.js in a new thread to keep Node.js from blocking the UI. __The node thread__ runs the entry script and has access to all the Node.js API, but there is no DOM access. A DeskGap app starts one node thread.

JavaScript scripts executed inside the browser window can directly access DOM and manipulate the UI. They are running in a __UI thread__. Scripts in UI thread have no direct access to Node.js or any native resources just like normal browsers, but unlike browsers, a global object `window.deskgap` is available to UI scripts.

__The node thread__ and __the UI thread__ are analogous to __the main process__ and __the renderer process__ in Electron.

## Communication Between the Node Thread And UI Threads.

DeskGap exposes three scoped communication levels between UI threads and the
Node thread:

* Small JSON commands use `WebView.handle()` in Node and
	`window.deskgap.invoke()` in the browser.
* Fetch-shaped request and response work uses `WebView.handleService()` and
	`window.deskgap.fetch()`.
* Long-lived or binary duplex traffic uses `TransportChannel`.

Each WebView receives an authenticated, navigation-scoped transport identity.
The server derives the sender WebView and navigation generation from that
identity rather than trusting renderer-provided fields. See
[Electron Compatibility](electron-compatibility.md) for transport details.


## Synchronous And Asynchronous Dispatching

Most UI-related APIs (like constructing a window, or load a html file) in the node thread dispatches an action __synchronously__  to the __UI thread__. In others words, these APIs are __blocking__ and will wait until the UI thread finishes. The delay may not be noticeable to users but Node.js in DeskGap is not a suitable place for running a web server in the production.

Due to the lack of related functionalities provided by the system’s webview, UI threads do not have any API that __synchronously__ dispatches actions to the node thread. All messages and invocations from UI threads are dispatched __asynchronously__. APIs such as Electron's deprecated `remote` module are intentionally unsupported.
