import { EventEmitter, IEventMap, IEventObject } from './internal/events';
import appPath from './internal/app-path';
import path = require('path');
import globals from './internal/globals';
import { WebViewNative } from './internal/native';
import { isValidServiceName, loopbackTransport, TransportRequestContext } from './internal/loopback-transport';
import { WebSocket } from 'ws';
import { createHash } from 'crypto';
import appInfo from './internal/app-info';
import { Session, session as sessionModule } from './session';
import type { BrowserWindow, IBrowserWindowConstructorOptions } from './browser-window';
import { NativeFileDropEntry, NativeFileHandleRegistry } from './internal/native-file-handles';
import {
    decodeChannelDataFrame,
    decodeTransportFrame,
    encodeChannelDataFrame,
    encodeTransportFrame,
    maximumTransportFrameBytes,
    UnversionedTransportFrame,
} from '../common/transport-protocol';
import { TransportChannel } from '../common/transport-channel';
import {
    InvokeFailure,
    invokeServiceName,
    readInvokeJSON,
    serializeInvokeValue,
    validateInvokeName,
} from '../common/invoke-protocol';

const isWinRTEngineAvailable = process.platform === 'win32' && WebViewNative.isWinRTEngineAvailable();
const webview2Version = process.platform === 'win32' ? WebViewNative.getWebview2Version() : "";
export type Engine = 'winrt' | 'webview2';

let defaultEngine: Engine | null = null;
if (process.platform === 'win32') {
    defaultEngine = webview2Version !== '' ? 'webview2' : isWinRTEngineAvailable ? 'winrt' : null;
}

const engineCodeByName: Record<Engine, number> = {
    'winrt': 1,
    'webview2': 2,
};

function isEngine(value: unknown): value is Engine {
    return value === 'winrt' || value === 'webview2';
}

const applicationHost = `app-${createHash('sha256').update(appInfo.id).digest('hex').substring(0, 32)}.deskgap.test`;

export interface ServiceRequestContext extends TransportRequestContext {
    resolveFileHandle(handle: string): string;
}

export interface InvokeHandlerContext extends ServiceRequestContext {
    readonly signal: AbortSignal;
    readonly webView: WebView;
}

export type InvokeHandler<Args = unknown, Result = unknown> = (
    context: InvokeHandlerContext,
    args: Args,
) => Result | Promise<Result>;

export interface WebViewEvents extends IEventMap {
    'did-finish-load': [];
    'did-start-navigation': [string, boolean, boolean];
    'did-redirect-navigation': [string, boolean, boolean];
    'did-fail-load': [number, string, string, boolean];
    'will-navigate': [string];
    'will-redirect': [string];
    'did-create-window': [BrowserWindow, WindowOpenDetails];
    'render-process-gone': [RenderProcessGoneDetails];
    'console-message': [];
    'channel-opened': [TransportChannel];
    'transport-ready': [];
    'page-title-updated': [string];
    'files-dropped': [string[]];
}

export interface RenderProcessGoneDetails {
    reason: string;
    exitCode: number;
}

export type ConsoleMessageLevel = 'debug' | 'info' | 'warning' | 'error';

export interface ConsoleMessageEvent {
    level: ConsoleMessageLevel;
    message: string;
    lineNumber: number;
    sourceId: string;
}

export interface WindowOpenDetails {
    url: string;
    frameName: string;
    features: string;
    disposition: 'new-window';
}

export interface WindowOpenHandlerResponse {
    action: 'allow' | 'deny';
    overrideBrowserWindowOptions?: Partial<IBrowserWindowConstructorOptions>;
}

export type WindowOpenHandler = (details: WindowOpenDetails) => WindowOpenHandlerResponse;

export interface FindInPageOptions {
    forward?: boolean;
    findNext?: boolean;
    matchCase?: boolean;
}

export type StopFindInPageAction = 'clearSelection' | 'keepSelection' | 'activateSelection';

export interface WebView {
    on(eventName: 'console-message', listener: (event: IEventObject<this> & ConsoleMessageEvent) => void): this;
    on<K extends keyof WebViewEvents>(eventName: K, listener: (event: IEventObject<this>, ...args: WebViewEvents[K]) => void): this;
    once(eventName: 'console-message', listener: (event: IEventObject<this> & ConsoleMessageEvent) => void): this;
    once<K extends keyof WebViewEvents>(eventName: K, listener: (event: IEventObject<this>, ...args: WebViewEvents[K]) => void): this;
}

export interface WebPreferences {
    engine: Engine | null;
    session?: Session;
}

let currentId = 0;

export class WebView extends EventEmitter<WebViewEvents> {
    /** @internal */ private id_: number;
    /** @internal */ private native_: WebViewNative;
    /** @internal */ private isDestroyed_ = false;
    /** @internal */ private engine_: Engine | null;
    /** @internal */ private session_: Session;
    /** @internal */ private navigationGeneration_ = 0;
    /** @internal */ private socket_: WebSocket | null = null;
    /** @internal */ private pendingSocketMessages_: string[] = [];
    /** @internal */ private pendingSocketBytes_ = 0;
    /** @internal */ private removeSocketHandler_: (() => void) | null = null;
    /** @internal */ private removeServiceHandler_: (() => void) | null = null;
    /** @internal */ private transportReady_: Promise<string>;
    /** @internal */ private serviceHandlers_ = new Map<string, (request: Request, context: ServiceRequestContext) => Response | Promise<Response>>();
    /** @internal */ private invokeHandlers_ = new Map<string, InvokeHandler<any, any>>();

    /** @internal */ private asyncNodeObjectsById_ = new Map<number, any>();
    /** @internal */ private asyncNodeValuesByName_ = new Map<string, any>();
    /** @internal */ private isDevToolsEnabled_: boolean = false;
    /** @internal */ private windowOpenHandler_: WindowOpenHandler | null = null;
    /** @internal */ private nextFindRequestId_ = 1;
    /** @internal */ private nextChannelId_ = 1;
    /** @internal */ private channels_ = new Map<number, TransportChannel>();
    /** @internal */ private nativeFileHandles_ = new NativeFileHandleRegistry();
    /** @internal */ private protocolRequests_ = new Map<number, AbortController>();

    constructor(
        callbacks: { onPageTitleUpdated: (title: string) => void, onReadyToShow: () => void },
        preferences: WebPreferences,
    ) {
        super();
        this.id_ = currentId;
        currentId++;

        if (preferences.engine != null && !isEngine(preferences.engine)) {
            throw new TypeError(`Unsupported webview engine: ${preferences.engine}`);
        }
        this.engine_ = preferences.engine || defaultEngine;
        if (process.platform === 'win32' && this.engine_ == null) {
            throw new Error('No supported webview engine is available. Install the Microsoft Edge WebView2 Runtime.');
        }
        this.session_ = preferences.session || sessionModule.defaultSession;
        const sessionOptions = this.session_.acquire(this.engine_);
        this.transportReady_ = loopbackTransport.start();

        this.removeSocketHandler_ = loopbackTransport.onSocket(connection => {
            if (connection.windowId !== this.id_ || connection.navigationGeneration !== this.navigationGeneration_) return;
            if (this.socket_ != null) {
                this.closeChannels_(1006, 'Transport replaced');
                this.socket_.close(1000, 'Replaced by a newer connection');
            }
            this.socket_ = connection.socket;
            this.trigger_('transport-ready');
            while (this.pendingSocketMessages_.length > 0) {
                const message = this.pendingSocketMessages_.shift()!;
                this.pendingSocketBytes_ -= Buffer.byteLength(message);
                if (connection.socket.bufferedAmount + Buffer.byteLength(message) > maximumTransportFrameBytes) {
                    this.pendingSocketMessages_ = [];
                    this.pendingSocketBytes_ = 0;
                    connection.socket.close(1009, 'Transport send queue exceeded');
                    break;
                }
                connection.socket.send(message);
            }
            connection.socket.on('message', (data, isBinary) => {
                if (this.isDestroyed()) return;
                try {
                    if (isBinary) {
                        const frame = decodeChannelDataFrame(data as Buffer);
                        const channel = this.channels_.get(frame.channelId);
                        if (channel == null) throw new Error('Unknown channel');
                        channel.receive(frame.payload);
                        return;
                    }
                    const frame = decodeTransportFrame(data.toString());
                    if (frame.type === 'channel-open') {
                        if ((frame.channelId & 1) !== 0 || this.channels_.has(frame.channelId)) throw new Error('Invalid browser channel id');
                        const channel = this.createChannelEndpoint_(frame.channelId);
                        this.channels_.set(frame.channelId, channel);
                        this.trigger_('channel-opened', null, channel);
                    }
                    else if (frame.type === 'channel-credit') {
                        const channel = this.channels_.get(frame.channelId);
                        if (channel == null) throw new Error('Unknown channel');
                        channel.grantCredit(frame.bytes);
                    }
                    else if (frame.type === 'channel-close') {
                        const channel = this.channels_.get(frame.channelId);
                        if (channel == null) throw new Error('Unknown channel');
                        this.channels_.delete(frame.channelId);
                        channel.remoteClose(frame.code, frame.reason);
                    }
                }
                catch (error) {
                    connection.socket.close(1002, 'Invalid transport frame');
                }
            });
            connection.socket.once('close', () => {
                if (this.socket_ === connection.socket) {
                    this.socket_ = null;
                    this.closeChannels_(1006, 'Transport disconnected');
                }
            });
        });
        this.removeServiceHandler_ = loopbackTransport.onServiceRequest((request, context) => {
            if (context.windowId !== this.id_ || context.navigationGeneration !== this.navigationGeneration_) return null;
            const handler = this.serviceHandlers_.get(context.serviceName);
            return handler == null ? null : handler(request, {
                ...context,
                resolveFileHandle: handle => this.nativeFileHandles_.resolve(handle, context.navigationGeneration),
            });
        });
        this.serviceHandlers_.set(invokeServiceName, (request, context) => this.handleInvokeRequest_(request, context));

        this.native_ = new WebViewNative({
            didFinishLoad: () => {
                if (this.isDestroyed()) return;
                try {
                    this.trigger_('did-finish-load');
                }
                finally {
                    callbacks.onReadyToShow();
                }
            },
            didStartNavigation: (url: string, isRedirect: boolean) => {
                if (this.isDestroyed()) return;
                if (!isRedirect) this.nativeFileHandles_.revokeAll();
                this.trigger_('did-start-navigation', null, url, false, true);
                if (isRedirect) this.trigger_('did-redirect-navigation', null, url, false, true);
            },
            didFailLoad: (errorCode: number, errorDescription: string, validatedURL: string) => {
                if (this.isDestroyed()) return;
                this.trigger_('did-fail-load', null, errorCode, errorDescription, validatedURL, true);
            },
            onNavigationPolicyRequest: (requestId: number, url: string, isRedirect: boolean) => {
                if (this.isDestroyed()) return;
                let allow = false;
                this.trigger_(isRedirect ? 'will-redirect' : 'will-navigate', {
                    defaultAction: () => { allow = true; }
                }, url);
                this.native_.resolveNavigationPolicy(requestId, allow);
            },
            onNewWindowRequested: (url: string, frameName: string, features: string) => {
                if (this.isDestroyed() || this.windowOpenHandler_ == null) return;
                const details: WindowOpenDetails = { url, frameName, features, disposition: 'new-window' };
                const result = this.windowOpenHandler_(details);
                if (result == null || result.action !== 'allow') return;
                const { BrowserWindow } = require('./browser-window') as typeof import('./browser-window');
                const overrideOptions = result.overrideBrowserWindowOptions || {};
                const child = new BrowserWindow({
                    ...overrideOptions,
                    webPreferences: {
                        ...overrideOptions.webPreferences,
                        session: overrideOptions.webPreferences?.session || this.session_,
                    },
                });
                child.loadURL(url);
                this.trigger_('did-create-window', null, child, details);
            },
            onRenderProcessGone: (reason: string, exitCode: number) => {
                if (this.isDestroyed()) return;
                this.trigger_('render-process-gone', null, { reason, exitCode });
            },
            onConsoleMessage: (level: string, message: string) => {
                if (this.isDestroyed()) return;
                this.trigger_('console-message', {
                    eventProperties: { level, message, lineNumber: 0, sourceId: '' }
                });
            },
            onPageTitleUpdated: (title: string) => {
                try {
                    if (this.isDestroyed()) return;
                    this.trigger_('page-title-updated', null, title);
                }
                finally {
                    callbacks.onPageTitleUpdated(title);
                }
            },
            onFilesDropped: (paths: string[]) => {
                if (this.isDestroyed()) return;
                this.trigger_('files-dropped', null, paths);
                const entries = this.nativeFileHandles_.issue(paths, this.navigationGeneration_);
                if (entries.length > 0) this.sendNativeFileDrop_(entries);
            },
            onCustomProtocolRequest: (requestId, method, url, headers) => {
                if (this.isDestroyed()) return;
                const controller = new AbortController();
                this.protocolRequests_.set(requestId, controller);
                void this.session_.dispatchProtocolRequest({ body: null, headers, method, url }, controller.signal).then(
                    response => {
                        if (this.protocolRequests_.get(requestId) !== controller) return;
                        this.protocolRequests_.delete(requestId);
                        this.native_.resolveCustomProtocolRequest(
                            requestId,
                            response.statusCode,
                            response.statusText,
                            response.headers,
                            response.body,
                        );
                    },
                    error => {
                        if (this.protocolRequests_.get(requestId) !== controller) return;
                        this.protocolRequests_.delete(requestId);
                        const message = error instanceof Error ? error.message : 'Custom protocol handler failed';
                        this.native_.resolveCustomProtocolRequest(
                            requestId,
                            500,
                            'Internal Server Error',
                            [['Content-Type', 'text/plain; charset=utf-8']],
                            Buffer.from(message),
                        );
                    },
                );
            },
            onCustomProtocolRequestCancelled: requestId => {
                const controller = this.protocolRequests_.get(requestId);
                if (controller == null) return;
                this.protocolRequests_.delete(requestId);
                controller.abort();
            },
        }, this.engine_ == null ? null : engineCodeByName[this.engine_], sessionOptions);
    }

    handle<Args = unknown, Result = unknown>(name: string, handler: InvokeHandler<Args, Result>): () => void {
        validateInvokeName(name);
        if (typeof handler !== 'function') throw new TypeError('Invoke handler must be a function');
        if (this.invokeHandlers_.has(name)) throw new Error(`Invoke handler already registered: ${name}`);
        this.invokeHandlers_.set(name, handler);
        return () => {
            if (this.invokeHandlers_.get(name) === handler) this.invokeHandlers_.delete(name);
        };
    }

    removeHandler(name: string): boolean {
        validateInvokeName(name);
        return this.invokeHandlers_.delete(name);
    }

    handleService(
        serviceName: string,
        handler: (request: Request, context: ServiceRequestContext) => Response | Promise<Response>,
    ): () => void {
        if (!isValidServiceName(serviceName)) {
            throw new TypeError('Service name must contain only lowercase letters, digits, dots, hyphens, and underscores');
        }
        if (this.serviceHandlers_.has(serviceName)) {
            throw new Error(`Service already has a handler: ${serviceName}`);
        }
        this.serviceHandlers_.set(serviceName, handler);
        return () => {
            if (this.serviceHandlers_.get(serviceName) === handler) this.serviceHandlers_.delete(serviceName);
        };
    }

    get id(): number {
        return this.id_;
    }

    get engine(): Engine | null {
        return this.engine_;
    }

    get session(): Session {
        return this.session_;
    }

    get supportsNativeFileDrop(): boolean {
        return this.engine_ !== 'winrt';
    }

    resolveFileHandle(handle: string): string {
        return this.nativeFileHandles_.resolve(handle, this.navigationGeneration_);
    }

    createChannel(): TransportChannel {
        if (this.socket_ == null || this.socket_.readyState !== WebSocket.OPEN) {
            throw new Error('Cannot create a channel before the browser transport is connected');
        }
        if (this.nextChannelId_ > 0xffffffff) throw new Error('Transport channel id space is exhausted');
        const channelId = this.nextChannelId_;
        this.nextChannelId_ += 2;
        this.sendTransportFrame_({ type: 'channel-open', channelId });
        const channel = this.createChannelEndpoint_(channelId);
        this.channels_.set(channelId, channel);
        return channel;
    }

    isDestroyed(): boolean {
        return this.isDestroyed_;
    }

    setWindowOpenHandler(handler: WindowOpenHandler | null): void {
        if (handler != null && typeof handler !== 'function') {
            throw new TypeError('Window open handler must be a function or null');
        }
        this.windowOpenHandler_ = handler;
    }

    /** @internal */
    private destroyNative_(): void {
        loopbackTransport.revokeWindow(this.id_);
        this.nativeFileHandles_.revokeAll();
        for (const controller of this.protocolRequests_.values()) controller.abort();
        this.protocolRequests_.clear();
        this.closeChannels_(1001, 'WebView destroyed');
        if (this.removeSocketHandler_ != null) this.removeSocketHandler_();
        if (this.removeServiceHandler_ != null) this.removeServiceHandler_();
        this.removeSocketHandler_ = null;
        this.removeServiceHandler_ = null;
        this.pendingSocketMessages_ = [];
        this.pendingSocketBytes_ = 0;
        this.serviceHandlers_.clear();
        this.invokeHandlers_.clear();
        this.native_.destroy();
        this.isDestroyed_ = true;
    }

    /** @internal */
    private async handleInvokeRequest_(request: Request, context: ServiceRequestContext): Promise<Response> {
        const headers = { 'Content-Type': 'application/json' };
        const fail = (status: number, error: InvokeFailure['error']): Response => {
            let payload: InvokeFailure = { error };
            try { return new Response(serializeInvokeValue(payload), { status, headers }); }
            catch (_) {
                payload = { error: { name: error.name, message: error.message, code: error.code } };
                return new Response(serializeInvokeValue(payload), { status, headers });
            }
        };
        if (request.method !== 'POST') return fail(405, { name: 'MethodNotAllowedError', message: 'Invoke requires POST' });

        let name: string;
        let body: any;
        try {
            const encodedName = new URL(request.url).pathname.substring(1);
            if (encodedName === '' || encodedName.includes('/')) throw new TypeError('Invalid invoke handler name');
            name = decodeURIComponent(encodedName);
            validateInvokeName(name);
            body = await readInvokeJSON(request);
            if (body == null || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'args')) {
                throw new TypeError('Invoke request must contain args');
            }
            serializeInvokeValue(body);
        }
        catch (error) {
            return fail(400, this.serializeInvokeError_(error, 'InvalidInvokeRequestError'));
        }

        const handler = this.invokeHandlers_.get(name);
        if (handler == null) return fail(404, { name: 'HandlerNotFoundError', message: `No invoke handler registered for: ${name}` });
        try {
            const value = await handler({ ...context, signal: request.signal, webView: this }, body.args);
            return new Response(serializeInvokeValue({ value }), { status: 200, headers });
        }
        catch (error) {
            return fail(500, this.serializeInvokeError_(error, 'Error'));
        }
    }

    /** @internal */
    private serializeInvokeError_(error: unknown, fallbackName: string): InvokeFailure['error'] {
        if (!(error instanceof Error)) return { name: fallbackName, message: String(error) };
        const result: InvokeFailure['error'] = { name: error.name || fallbackName, message: error.message };
        const source = error as Error & { code?: unknown, details?: unknown };
        if (typeof source.code === 'string') result.code = source.code;
        if (source.details !== undefined) result.details = source.details;
        return result;
    }

    loadFile(filePath: string): void {
        const absolutePath = path.resolve(appPath, filePath);
        const navigationGeneration = this.beginNavigation_();
        this.transportReady_.then(() => {
            if (this.isDestroyed() || navigationGeneration !== this.navigationGeneration_) return;
            const origin = this.engine_ === 'webview2'
                ? `http://${applicationHost}`
                : process.platform === 'win32' ? 'null' : `deskgap-local://${applicationHost}`;
            const bootstrap = loopbackTransport.issueWindowTicket(this.id_, navigationGeneration, origin);
            const fragment = `__deskgap_transport=${encodeURIComponent(JSON.stringify(bootstrap))}`;
            this.native_.loadLocalFile(absolutePath, fragment, applicationHost);
        }, () => {
            if (!this.isDestroyed() && navigationGeneration === this.navigationGeneration_) {
                this.native_.loadLocalFile(absolutePath, '', applicationHost);
            }
        });
    }
    loadURL(url: string): void {
        this.beginNavigation_();
        const errorMessage = this.native_.loadRequest("GET", url, [], undefined);
        if (errorMessage != null) {
            throw new Error(errorMessage);
        }
    }

    setDevToolsEnabled(enabled: boolean): void {
        this.native_.setDevToolsEnabled(enabled);
        this.isDevToolsEnabled_ = enabled;
    }

    openDevTools(): void {
        this.setDevToolsEnabled(true);
    }

    closeDevTools(): void {
        this.setDevToolsEnabled(false);
    }

    isDevToolsOpened(): boolean {
        return this.isDevToolsEnabled_;
    }

    isDevToolsEnabled(): boolean {
        return this.isDevToolsEnabled_;
    }

    reload(): void {
        this.nativeFileHandles_.revokeAll();
        this.native_.reload();
    }

    findInPage(text: string, options: FindInPageOptions = {}): number {
        if (text.length === 0) throw new TypeError('Search text cannot be empty');
        const requestId = this.nextFindRequestId_++;
        const script = `window.find(${JSON.stringify(text)}, ${!!options.matchCase}, ${options.forward === false}, true, false, false, false)`;
        this.native_.executeJavaScript(script, null);
        return requestId;
    }

    stopFindInPage(action: StopFindInPageAction): void {
        if (!['clearSelection', 'keepSelection', 'activateSelection'].includes(action)) {
            throw new TypeError(`Unsupported stop-find action: ${action}`);
        }
        if (action === 'clearSelection') {
            this.native_.executeJavaScript('window.getSelection()?.removeAllRanges()', null);
        }
    }

    /** @internal */
    private beginNavigation_(): number {
        this.navigationGeneration_++;
        loopbackTransport.revokeWindow(this.id_);
        this.nativeFileHandles_.revokeAll();
        this.pendingSocketMessages_ = [];
        this.pendingSocketBytes_ = 0;
        return this.navigationGeneration_;
    }

    /** @internal */
    private sendNativeFileDrop_(entries: NativeFileDropEntry[]): void {
        const serialized = encodeTransportFrame({ type: 'native-file-drop', entries });
        if (this.socket_ != null && this.socket_.readyState === WebSocket.OPEN) {
            if (this.socket_.bufferedAmount + Buffer.byteLength(serialized) > maximumTransportFrameBytes) {
                this.nativeFileHandles_.revokeAll();
                return;
            }
            this.socket_.send(serialized);
        }
        else {
            if (!this.queueSocketMessage_(serialized)) this.nativeFileHandles_.revokeAll();
        }
    }

    /** @internal */
    private queueSocketMessage_(message: string): boolean {
        const messageBytes = Buffer.byteLength(message);
        if (messageBytes > maximumTransportFrameBytes || this.pendingSocketBytes_ + messageBytes > maximumTransportFrameBytes) {
            return false;
        }
        this.pendingSocketMessages_.push(message);
        this.pendingSocketBytes_ += messageBytes;
        return true;
    }

    /** @internal */
    private createChannelEndpoint_(channelId: number): TransportChannel {
        return new TransportChannel(channelId, {
            sendBinary: async (_id, data) => {
                const socket = this.socket_;
                if (socket == null || socket.readyState !== WebSocket.OPEN) throw new Error('Channel transport is disconnected');
                const frame = encodeChannelDataFrame(channelId, data);
                if (socket.bufferedAmount + frame.byteLength > maximumTransportFrameBytes) {
                    throw new Error('Channel transport send queue is full');
                }
                socket.send(Buffer.from(frame));
            },
            sendControl: frame => {
                if (frame.type === 'channel-close') this.channels_.delete(channelId);
                this.sendTransportFrame_(frame);
            },
        });
    }

    /** @internal */
    private sendTransportFrame_(frame: UnversionedTransportFrame): void {
        const socket = this.socket_;
        if (socket == null || socket.readyState !== WebSocket.OPEN) throw new Error('Transport is disconnected');
        const serialized = encodeTransportFrame(frame);
        if (socket.bufferedAmount + Buffer.byteLength(serialized) > maximumTransportFrameBytes) {
            throw new Error('DeskGap transport send queue is full');
        }
        socket.send(serialized);
    }

    /** @internal */
    private closeChannels_(code: number, reason: string): void {
        const channels = Array.from(this.channels_.values());
        this.channels_.clear();
        for (const channel of channels) channel.remoteClose(code, reason);
    }
}

export const WebViews = {
    getAllWebViews(): WebView[] {
        return Array.from(globals.webViewsById.values());
    },

    /**
     * Alias to [[getAllWebViews]]
     */
    getAllWebContents(): WebView[] {
        return this.getAllWebViews();
    },

    /**
     * Alias to [[getFocusedWebView]]
     */
    getFocusedWebContents(): WebView | null {
        return this.getFocusedWebView();
    },
    getFocusedWebView(): WebView | null {

        if (globals.focusedBrowserWindow == null) {
            return null;
        }
        return globals.focusedBrowserWindow.webContents;
    },
    fromId(id: number): WebView | null {
        return globals.webViewsById.get(id) || null;
    },

    setDefaultEngine(engine: Engine): void {
        if (!isEngine(engine)) {
            throw new TypeError(`Unsupported webview engine: ${engine}`);
        }
        defaultEngine = engine;
    },

    getDefaultEngine(): Engine | null {
        return defaultEngine;
    },

    isEngineAvailable(engine: Engine): boolean {
        if (process.platform !== 'win32') {
            return false;
        }
        if (engine === 'winrt') {
            return WebViewNative.isWinRTEngineAvailable();
        }
        if (engine === 'webview2') {
            return webview2Version !== '';
        }
        return false;
    },

    isNativeFileDropSupported(engine: Engine | null = defaultEngine): boolean {
        return engine !== 'winrt';
    },
}
