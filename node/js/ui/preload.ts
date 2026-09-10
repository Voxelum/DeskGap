import './compatibility'
import { internalDeskGap } from './bootstrap'
import {
    decodeChannelDataFrame,
    decodeTransportFrame,
    encodeChannelDataFrame,
    encodeTransportFrame,
    maximumTransportFrameBytes,
    UnversionedTransportFrame,
} from '../common/transport-protocol'
import { TransportChannel } from '../common/transport-channel'
import { parseServiceURL } from '../common/service-protocol'
import { encodeUTF8 } from '../common/utf8'
import {
    InvokeFailure,
    invokeServiceName,
    readInvokeJSON,
    serializeInvokeValue,
    validateInvokeName,
} from '../common/invoke-protocol'

let loopbackSocket: WebSocket | null = null;
let transportSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let transportBootstrapPromise: Promise<TransportBootstrap> | null = null;
let nextChannelId = 2;
const channels = new Map<number, TransportChannel>();
interface WindowTicket {
    ticket: string;
    transportOrigin: string;
}

interface TransportBootstrap {
    token: string;
    socketUrl: string;
    windowId: number;
    navigationGeneration: number;
}

export interface NativeFileDropEntry {
    readonly handle: string;
    readonly kind: 'file' | 'directory';
    readonly name: string;
    readonly size: number | null;
}

export class NativeFileDropEvent extends Event {
    constructor(readonly entries: readonly NativeFileDropEntry[]) {
        super('files-dropped');
    }
}

export class TransportChannelEvent extends Event {
    constructor(readonly channel: TransportChannel) {
        super('channel');
    }
}

export interface InvokeOptions {
    signal?: AbortSignal;
}

export class InvokeError extends Error {
    readonly code?: string;
    readonly details?: unknown;
    readonly remoteName: string;

    constructor(error: InvokeFailure['error']) {
        super(error.message);
        this.name = 'InvokeError';
        this.remoteName = error.name;
        this.code = error.code;
        this.details = error.details;
    }
}

const transportStorageKey = '__deskgap_transport';

function readWindowTicket(): WindowTicket | null {
    const prefix = '#__deskgap_transport=';
    if (window.location.hash.indexOf(prefix) !== 0) return null;
    try {
        const ticket = JSON.parse(decodeURIComponent(window.location.hash.substring(prefix.length)));
        window.history.replaceState(null, '', window.location.href.substring(0, window.location.href.indexOf('#')));
        return ticket;
    }
    catch (_) {
        return null;
    }
}

function connectLoopback(bootstrap: TransportBootstrap, reconnectAttempt = 0): void {
    if (transportSocket != null && (transportSocket.readyState === WebSocket.CONNECTING || transportSocket.readyState === WebSocket.OPEN)) return;
    const socket = new WebSocket(bootstrap.socketUrl);
    transportSocket = socket;
    socket.binaryType = 'arraybuffer';
    let authenticated = false;
    socket.addEventListener('open', () => {
        socket.send(encodeTransportFrame({ type: 'authenticate', token: bootstrap.token }));
    });
    socket.addEventListener('message', event => {
        if (event.data instanceof ArrayBuffer) {
            if (!authenticated) {
                socket.close(1008, 'Transport is not authenticated');
                return;
            }
            try {
                const frame = decodeChannelDataFrame(event.data);
                const channel = channels.get(frame.channelId);
                if (channel == null) throw new Error('Unknown channel');
                channel.receive(frame.payload);
            }
            catch (_) {
                socket.close(1002, 'Invalid transport frame');
            }
            return;
        }
        let message;
        try {
            message = decodeTransportFrame(event.data);
        }
        catch (_) {
            socket.close(1002, 'Invalid transport frame');
            return;
        }
        if (message.type === 'authenticated') {
            if (message.windowId !== bootstrap.windowId || message.navigationGeneration !== bootstrap.navigationGeneration) {
                socket.close(1008, 'Window identity mismatch');
                return;
            }
            authenticated = true;
            if (reconnectTimer != null) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            loopbackSocket = socket;
            return;
        }
        if (!authenticated) {
            socket.close(1008, 'Transport is not authenticated');
            return;
        }
        if (message.type === 'native-file-drop' && Array.isArray(message.entries)) {
            const entries = message.entries.filter((entry: any) =>
                entry != null &&
                typeof entry.handle === 'string' &&
                (entry.kind === 'file' || entry.kind === 'directory') &&
                typeof entry.name === 'string' &&
                (entry.size === null || typeof entry.size === 'number')
            ).map((entry: any): NativeFileDropEntry => ({
                handle: entry.handle,
                kind: entry.kind,
                name: entry.name,
                size: entry.size,
            }));
            if (entries.length > 0) window.deskgap.dispatchEvent(new NativeFileDropEvent(entries));
            return;
        }
        if (message.type === 'channel-open') {
            if ((message.channelId & 1) !== 1 || channels.has(message.channelId)) {
                socket.close(1002, 'Invalid transport frame');
                return;
            }
            const channel = createChannelEndpoint(socket, message.channelId);
            channels.set(message.channelId, channel);
            window.deskgap.dispatchEvent(new TransportChannelEvent(channel));
        }
        else if (message.type === 'channel-credit') {
            const channel = channels.get(message.channelId);
            if (channel == null) socket.close(1002, 'Invalid transport frame');
            else channel.grantCredit(message.bytes);
        }
        else if (message.type === 'channel-close') {
            const channel = channels.get(message.channelId);
            if (channel == null) socket.close(1002, 'Invalid transport frame');
            else {
                channels.delete(message.channelId);
                channel.remoteClose(message.code, message.reason);
            }
        }
    });
    socket.addEventListener('close', event => {
        if (transportSocket !== socket) return;
        transportSocket = null;
        if (loopbackSocket === socket) {
            loopbackSocket = null;
            const openChannels = Array.from(channels.values());
            channels.clear();
            for (const channel of openChannels) channel.remoteClose(1006, 'Transport disconnected');
        }
        if (event.code === 1008 || event.code === 1002) {
            window.sessionStorage.removeItem(transportStorageKey);
            transportBootstrapPromise = null;
            return;
        }
        const delay = Math.min(100 * Math.pow(2, reconnectAttempt), 5000);
        reconnectTimer = setTimeout(() => connectLoopback(bootstrap, reconnectAttempt + 1), delay);
    });
}

function startLoopbackTransport(): void {
    const ticket = readWindowTicket();
    let storedBootstrap: TransportBootstrap | null = null;
    try {
        storedBootstrap = JSON.parse(window.sessionStorage.getItem(transportStorageKey) || 'null');
    }
    catch (_) { }

    if (ticket == null && storedBootstrap == null) return;
    if (ticket == null) {
        transportBootstrapPromise = Promise.resolve(storedBootstrap!);
        connectLoopback(storedBootstrap!);
        return;
    }

    window.sessionStorage.removeItem(transportStorageKey);
    const bootstrapPromise = fetch(`${ticket.transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: ticket.ticket }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    }).then(response => {
        if (!response.ok) throw new Error(`DeskGap transport bootstrap failed with status ${response.status}`);
        return response.json();
    }).then((bootstrap: TransportBootstrap) => {
        window.sessionStorage.setItem(transportStorageKey, JSON.stringify(bootstrap));
        connectLoopback(bootstrap);
        return bootstrap;
    }).catch(() => {
        transportBootstrapPromise = null;
        throw new Error('DeskGap loopback transport is unavailable');
    });
    transportBootstrapPromise = bootstrapPromise;
    void bootstrapPromise.catch(() => {});
}

export class DeskGapInBroswer extends EventTarget {
    readonly platform = <'darwin' | 'win32' | 'linux'>internalDeskGap.platform;
    constructor() {
        super();
    }
    onFilesDropped(listener: (event: NativeFileDropEvent) => void): () => void {
        const eventListener: EventListener = event => listener(event as NativeFileDropEvent);
        this.addEventListener('files-dropped', eventListener);
        return () => this.removeEventListener('files-dropped', eventListener);
    }
    onChannel(listener: (event: TransportChannelEvent) => void): () => void {
        const eventListener: EventListener = event => listener(event as TransportChannelEvent);
        this.addEventListener('channel', eventListener);
        return () => this.removeEventListener('channel', eventListener);
    }
    createChannel(): TransportChannel {
        const socket = loopbackSocket;
        if (socket == null || socket.readyState !== WebSocket.OPEN) {
            throw new Error('Cannot create a channel before the DeskGap transport is connected');
        }
        if (nextChannelId > 0xffffffff) throw new Error('Transport channel id space is exhausted');
        const channelId = nextChannelId;
        nextChannelId += 2;
        sendControlFrame(socket, { type: 'channel-open', channelId });
        const channel = createChannelEndpoint(socket, channelId);
        channels.set(channelId, channel);
        return channel;
    }
    async invoke<Result = unknown, Args = null>(
        name: string,
        args: Args = null as Args,
        options: InvokeOptions = {},
    ): Promise<Result> {
        validateInvokeName(name);
        const body = serializeInvokeValue({ args });
        const response = await this.fetch(
            `service://${invokeServiceName}/${encodeURIComponent(name)}`,
            {
                body,
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
                signal: options.signal,
            },
        );
        const result = await readInvokeJSON(response);
        if (!response.ok) {
            if (result?.error != null && typeof result.error.name === 'string' && typeof result.error.message === 'string') {
                throw new InvokeError(result.error);
            }
            throw new Error(`Invoke failed with status ${response.status}`);
        }
        if (result == null || !Object.prototype.hasOwnProperty.call(result, 'value')) {
            throw new Error('Invoke response has no value');
        }
        return result.value as Result;
    }

    async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
        const sourceBody = init?.body;
        const request = new Request(input, init);
        const serviceUrl = parseServiceURL(request.url);
        if (transportBootstrapPromise == null) {
            throw new Error('DeskGap loopback transport is unavailable');
        }
        const bootstrap = await transportBootstrapPromise;
        const headers = new Headers(request.headers);
        headers.set('Authorization', `Bearer ${bootstrap.token}`);
        const serviceName = encodeURIComponent(serviceUrl.serviceName);
        const transportOrigin = new URL(bootstrap.socketUrl.replace(/^ws/, 'http')).origin;
        const serviceRequestUrl = `${transportOrigin}/__deskgap/service/${serviceName}${serviceUrl.pathname}${serviceUrl.search}`;
        const requestInit: RequestInit & { duplex?: 'half' } = {
            headers,
            method: request.method,
            signal: request.signal,
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            requestInit.body = sourceBody == null ? request.body : sourceBody;
            requestInit.duplex = 'half';
        }
        return window.fetch(serviceRequestUrl, requestInit);
    }
}

declare global {
    interface Window {
        deskgap: DeskGapInBroswer;
    }
}

window.deskgap = new DeskGapInBroswer();

startLoopbackTransport();

function createChannelEndpoint(socket: WebSocket, channelId: number): TransportChannel {
    return new TransportChannel(channelId, {
        sendBinary: async (_id, data) => {
            if (socket !== loopbackSocket || socket.readyState !== WebSocket.OPEN) throw new Error('Channel transport is disconnected');
            const frame = encodeChannelDataFrame(channelId, data);
            if (socket.bufferedAmount + frame.byteLength > maximumTransportFrameBytes) {
                throw new Error('Channel transport send queue is full');
            }
            socket.send(frame);
        },
        sendControl: frame => {
            if (frame.type === 'channel-close') channels.delete(channelId);
            sendControlFrame(socket, frame);
        },
    });
}

function sendControlFrame(socket: WebSocket, frame: UnversionedTransportFrame): void {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Transport is disconnected');
    const serialized = encodeTransportFrame(frame);
    if (socket.bufferedAmount + encodeUTF8(serialized).byteLength > maximumTransportFrameBytes) {
        throw new Error('DeskGap transport send queue is full');
    }
    socket.send(serialized);
}
