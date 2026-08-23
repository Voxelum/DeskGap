import { createHash, randomUUID } from 'crypto';
import { rmSync } from 'fs';
import path = require('path');
import { app } from './app';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import type Dispatcher from 'undici/types/dispatcher';
import { STATUS_CODES } from 'http';

export type SessionKind = 'default' | 'persistent' | 'ephemeral';

export interface ProxyConfig {
    mode?: 'direct' | 'system' | 'fixed_servers';
    proxyRules?: string;
    proxyBypassRules?: string;
}

export interface NativeSessionOptions {
    id: string;
    kind: SessionKind;
    name: string | null;
    dataPath: string | null;
    userAgent: string | null;
    proxyRules: string | null;
    proxyBypassRules: string | null;
    customSchemes: ProtocolRegistration[];
}

export interface ProtocolRegistration {
    scheme: string;
}

export interface ProtocolRequestContext {
    readonly session: Session;
    readonly signal: AbortSignal;
}

export type ProtocolHandler = (request: Request, context: ProtocolRequestContext) => Response | Promise<Response>;

export interface NativeProtocolRequest {
    body: Buffer | null;
    headers: Array<[string, string]>;
    method: string;
    url: string;
}

export interface NativeProtocolResponse {
    body: Buffer;
    headers: Array<[string, string]>;
    statusCode: number;
    statusText: string;
}

export interface SessionFetchOptions extends RequestInit {
    bypassCustomProtocolHandlers?: boolean;
}

const maximumProtocolBodyBytes = 64 * 1024 * 1024;
const forbiddenProtocolSchemes = new Set(['about', 'blob', 'data', 'file', 'http', 'https', 'javascript', 'service', 'ws', 'wss']);

function validateProtocolScheme(scheme: string): string {
    if (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        throw new TypeError('Protocol scheme must start with a lowercase letter and contain only lowercase letters, digits, plus, dot, and hyphen');
    }
    if (scheme.startsWith('deskgap') || forbiddenProtocolSchemes.has(scheme)) {
        throw new TypeError(`Protocol scheme is reserved: ${scheme}`);
    }
    return scheme;
}

async function readProtocolResponseBody(response: Response, signal: AbortSignal): Promise<Buffer> {
    if (response.body == null) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = () => void reader.cancel(signal.reason).catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumProtocolBodyBytes) {
                await reader.cancel('Protocol response body exceeds the 64 MiB limit');
                throw new RangeError('Protocol response body exceeds the 64 MiB limit');
            }
            chunks.push(value);
        }
    }
    finally {
        signal.removeEventListener('abort', abort);
    }
    return Buffer.concat(chunks, size);
}

class Protocol {
    private readonly handlers_ = new Map<string, { handler: ProtocolHandler; registration: ProtocolRegistration }>();

    constructor(private readonly session_: Session) {}

    handle(scheme: string, handler: ProtocolHandler): () => void {
        this.session_.ensureMutableForProtocol_();
        validateProtocolScheme(scheme);
        if (typeof handler !== 'function') throw new TypeError('Protocol handler must be a function');
        if (this.handlers_.has(scheme)) throw new Error(`Protocol already has a handler: ${scheme}`);
        const registration: ProtocolRegistration = { scheme };
        this.handlers_.set(scheme, { handler, registration });
        return () => {
            this.session_.ensureMutableForProtocol_();
            if (this.handlers_.get(scheme)?.handler === handler) this.handlers_.delete(scheme);
        };
    }

    unhandle(scheme: string): boolean {
        this.session_.ensureMutableForProtocol_();
        validateProtocolScheme(scheme);
        return this.handlers_.delete(scheme);
    }

    isProtocolHandled(scheme: string): boolean {
        if (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
            throw new TypeError('Protocol scheme must start with a lowercase letter and contain only lowercase letters, digits, plus, dot, and hyphen');
        }
        return this.handlers_.has(scheme);
    }

    /** @internal */
    registrations(): ProtocolRegistration[] {
        return Array.from(this.handlers_.values(), value => ({
            scheme: value.registration.scheme,
        }));
    }

    /** @internal */
    async dispatch(request: NativeProtocolRequest, signal: AbortSignal): Promise<NativeProtocolResponse> {
        const url = new URL(request.url);
        const scheme = url.protocol.slice(0, -1);
        const entry = this.handlers_.get(scheme);
        if (entry == null) throw new Error(`Protocol has no handler: ${scheme}`);
        if (url.hostname === '') {
            return {
                body: Buffer.from('Custom protocol URLs require an authority'),
                headers: [['content-type', 'text/plain; charset=utf-8']],
                statusCode: 400,
                statusText: 'Bad Request',
            };
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return {
                body: Buffer.alloc(0),
                headers: [['allow', 'GET, HEAD']],
                statusCode: 405,
                statusText: 'Method Not Allowed',
            };
        }
        const headers = new Headers(request.headers);
        const init: RequestInit & { duplex?: 'half' } = { headers, method: request.method, signal };
        if (request.body != null && request.method !== 'GET' && request.method !== 'HEAD') {
            const body = new Uint8Array(request.body.byteLength);
            body.set(request.body);
            init.body = body;
            init.duplex = 'half';
        }
        const response = await entry.handler(new Request(request.url, init), { session: this.session_, signal });
        if (!(response instanceof Response)) throw new TypeError('Protocol handler must return a Response');
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maximumProtocolBodyBytes) {
            throw new RangeError('Protocol response body exceeds the 64 MiB limit');
        }
        const body = request.method === 'HEAD'
            ? (await response.body?.cancel(), Buffer.alloc(0))
            : await readProtocolResponseBody(response, signal);
        return {
            body,
            headers: Array.from(response.headers.entries()),
            statusCode: response.status,
            statusText: response.statusText || STATUS_CODES[response.status] || 'Unknown',
        };
    }
}

export class Session {
    private userAgent_: string | null = null;
    private proxyRules_: string | null = null;
    private proxyBypassRules_: string | null = null;
    private locked_ = false;
    private fetchDispatcher_: Dispatcher | null | undefined;
    readonly protocol = new Protocol(this);

    /** @internal */
    constructor(
        readonly kind: SessionKind,
        readonly name: string | null,
        private readonly dataPath_: string | null,
        readonly id: string,
    ) {
        if (kind === 'ephemeral' && dataPath_ != null) {
            process.once('exit', () => {
                try { rmSync(dataPath_, { force: true, recursive: true }); }
                catch { }
            });
        }
    }

    setUserAgent(userAgent: string): void {
        this.ensureMutable();
        this.userAgent_ = userAgent || null;
    }

    getUserAgent(): string {
        return this.userAgent_ || '';
    }

    async setProxy(config: ProxyConfig): Promise<void> {
        this.ensureMutable();
        const mode = config.mode || (config.proxyRules ? 'fixed_servers' : 'system');
        if (!['direct', 'system', 'fixed_servers'].includes(mode)) {
            throw new TypeError(`Unsupported proxy mode: ${mode}`);
        }
        for (const value of [config.proxyRules, config.proxyBypassRules]) {
            if (value != null && /["\r\n]/.test(value)) {
                throw new TypeError('Proxy rules cannot contain quotes or line breaks');
            }
        }
        this.proxyRules_ = mode === 'direct' ? 'direct://' : mode === 'system' ? null : config.proxyRules || null;
        this.proxyBypassRules_ = config.proxyBypassRules || null;
        this.fetchDispatcher_ = undefined;
    }

    async fetch(input: string | URL, options: SessionFetchOptions = {}): Promise<Response> {
        const { bypassCustomProtocolHandlers = false, ...requestOptions } = options;
        const headers = new Headers(requestOptions.headers);
        if (this.userAgent_ != null && !headers.has('User-Agent')) {
            headers.set('User-Agent', this.userAgent_);
        }
        const url = new URL(input);
        const scheme = url.protocol.slice(0, -1);
        if (!bypassCustomProtocolHandlers && this.protocol.isProtocolHandled(scheme)) {
            const signal = requestOptions.signal || new AbortController().signal;
            const result = await this.dispatchProtocolRequest({
                body: null,
                headers: Array.from(headers.entries()),
                method: requestOptions.method || 'GET',
                url: url.href,
            }, signal);
            const body = new Uint8Array(result.body.byteLength);
            body.set(result.body);
            return new Response(body, {
                headers: result.headers,
                status: result.statusCode,
                statusText: result.statusText,
            });
        }
        const dispatcher = this.getFetchDispatcher_();
        const response = await undiciFetch(url, {
            ...requestOptions,
            dispatcher: dispatcher || undefined,
            headers,
        } as any);
        return response as unknown as Response;
    }

    async closeAllConnections(): Promise<void> {
        const dispatcher = this.fetchDispatcher_;
        this.fetchDispatcher_ = undefined;
        if (dispatcher != null) await dispatcher.close();
    }

    /** @internal */
    acquire(engine: 'winrt' | 'webview2' | null): NativeSessionOptions {
        if (engine === 'winrt' && (this.kind !== 'default' || this.userAgent_ != null || this.proxyRules_ != null || this.protocol.registrations().length > 0)) {
            throw new Error('WinRT WebView does not support explicit sessions, user-agent overrides, proxies, or custom protocols');
        }
        if (process.platform === 'darwin') {
            if (this.kind === 'persistent') {
                throw new Error('Named persistent sessions require macOS 14 or later and are unavailable in this DeskGap build');
            }
            if (this.proxyRules_ != null) {
                throw new Error('WKWebView does not support per-session proxy configuration');
            }
        }
        this.locked_ = true;
        return {
            id: this.id,
            kind: this.kind,
            name: this.name,
            dataPath: this.dataPath_,
            userAgent: this.userAgent_,
            proxyRules: this.proxyRules_,
            proxyBypassRules: this.proxyBypassRules_,
            customSchemes: this.protocol.registrations(),
        };
    }

    /** @internal */
    dispatchProtocolRequest(request: NativeProtocolRequest, signal: AbortSignal): Promise<NativeProtocolResponse> {
        return this.protocol.dispatch(request, signal);
    }

    /** @internal */
    ensureMutableForProtocol_(): void {
        this.ensureMutable();
    }

    private ensureMutable(): void {
        if (this.locked_) {
            throw new Error('Session configuration cannot be changed after the session is attached to a webview');
        }
    }

    private getFetchDispatcher_(): Dispatcher | null {
        if (this.fetchDispatcher_ !== undefined) return this.fetchDispatcher_;
        if (this.proxyRules_ == null) {
            this.fetchDispatcher_ = null;
            return null;
        }
        if (this.proxyRules_ === 'direct://') {
            this.fetchDispatcher_ = new Agent();
            return this.fetchDispatcher_;
        }
        let proxyURL: URL;
        try {
            proxyURL = new URL(this.proxyRules_);
        }
        catch (_) {
            throw new Error('Session.fetch supports only a simple http:// or https:// proxy URL');
        }
        if (proxyURL.protocol !== 'http:' && proxyURL.protocol !== 'https:') {
            throw new Error('Session.fetch supports only HTTP and HTTPS proxies');
        }
        this.fetchDispatcher_ = new EnvHttpProxyAgent({
            httpProxy: proxyURL.href,
            httpsProxy: proxyURL.href,
            noProxy: this.proxyBypassRules_ || undefined,
        });
        return this.fetchDispatcher_;
    }
}

function persistentPath(name: string): string {
    const key = createHash('sha256').update(name).digest('hex').substring(0, 32);
    return path.join(app.getPath('sessionData'), key);
}

const defaultSession = new Session('default', null, path.join(app.getPath('sessionData'), 'default'), 'default');
const persistentSessions = new Map<string, Session>();
const ephemeralPartitions = new Map<string, Session>();

function createEphemeralSession(id = `ephemeral:${randomUUID()}`): Session {
    const dataPath = process.platform === 'win32'
        ? path.join(app.getPath('temp'), 'DeskGap', 'Sessions', randomUUID())
        : null;
    return new Session('ephemeral', null, dataPath, id);
}

export const session = {
    defaultSession,

    fromName(name: string): Session {
        if (name.length === 0) throw new TypeError('Session name cannot be empty');
        let existing = persistentSessions.get(name);
        if (existing == null) {
            existing = new Session('persistent', name, persistentPath(name), `persistent:${name}`);
            persistentSessions.set(name, existing);
        }
        return existing;
    },

    fromPartition(partition: string): Session {
        if (partition === '') return defaultSession;
        if (partition.startsWith('persist:')) return this.fromName(partition.substring(8));
        let existing = ephemeralPartitions.get(partition);
        if (existing == null) {
            existing = createEphemeralSession(`partition:${partition}`);
            ephemeralPartitions.set(partition, existing);
        }
        return existing;
    },

    createEphemeral(): Session {
        return createEphemeralSession();
    },
};
