import { randomBytes, timingSafeEqual } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { Readable } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { decodeTransportFrame, encodeTransportFrame, maximumTransportFrameBytes } from '../../common/transport-protocol';

const bootstrapPath = '/__deskgap/bootstrap';
const socketPath = '/__deskgap/socket';
const servicePathPrefix = '/__deskgap/service/';
const ticketLifetimeMs = 30_000;
const authenticationTimeoutMs = 5_000;
const maximumBootstrapBodyBytes = 4_096;
const responseHeadersManagedByTransport = new Set([
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

interface PendingTicket {
    expiresAt: number;
    origin: string;
    windowId: number;
    navigationGeneration: number;
}

interface WindowCredential extends PendingTicket {
    token: string;
}

export interface WindowTicket {
    ticket: string;
    transportOrigin: string;
}

export interface AuthenticatedSocket {
    socket: WebSocket;
    windowId: number;
    navigationGeneration: number;
}

export interface TransportRequestContext {
    navigationGeneration: number;
    serviceName: string;
    windowId: number;
}

type ServiceRequestHandler = (request: Request, context: TransportRequestContext) => Response | null | Promise<Response | null>;

export function isValidServiceName(serviceName: string): boolean {
    return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(serviceName);
}

export class LoopbackTransport {
    private server_: Server | null = null;
    private socketServer_: WebSocketServer | null = null;
    private startPromise_: Promise<string> | null = null;
    private transportOrigin_: string | null = null;
    private pendingTickets_ = new Map<string, PendingTicket>();
    private credentialsByToken_ = new Map<string, WindowCredential>();
    private socketsByWindowId_ = new Map<number, Set<WebSocket>>();
    private socketHandlers_ = new Set<(connection: AuthenticatedSocket) => void>();
    private serviceRequestHandlers_ = new Set<ServiceRequestHandler>();

    start(): Promise<string> {
        if (this.transportOrigin_ != null) return Promise.resolve(this.transportOrigin_);
        if (this.startPromise_ != null) return this.startPromise_;

        const startPromise = this.startServer_();
        this.startPromise_ = startPromise;
        void startPromise.then(
            () => {
                if (this.startPromise_ === startPromise) this.startPromise_ = null;
            },
            () => {
                if (this.startPromise_ === startPromise) this.startPromise_ = null;
            },
        );
        return startPromise;
    }

    private async startServer_(): Promise<string> {
        const socketServer = new WebSocketServer({ noServer: true, maxPayload: maximumTransportFrameBytes });
        const server = createServer((request, response) => this.handleHttpRequest_(request, response));
        this.socketServer_ = socketServer;
        this.server_ = server;

        server.on('upgrade', (request, socket, head) => {
            if (!this.isExpectedHost_(request) || request.url !== socketPath) {
                socket.destroy();
                return;
            }
            socketServer.handleUpgrade(request, socket, head, webSocket => {
                this.authenticateSocket_(webSocket, request);
            });
        });

        try {
            await new Promise<void>((resolve, reject) => {
                const onError = (error: Error) => {
                    server.off('listening', onListening);
                    reject(error);
                };
                const onListening = () => {
                    server.off('error', onError);
                    resolve();
                };
                server.once('error', onError);
                server.once('listening', onListening);
                server.listen(0, '127.0.0.1');
            });
        }
        catch (error) {
            this.server_ = null;
            this.socketServer_ = null;
            socketServer.close();
            throw error;
        }

        const address = server.address() as AddressInfo;
        this.transportOrigin_ = `http://127.0.0.1:${address.port}`;
        server.unref();
        return this.transportOrigin_;
    }

    issueWindowTicket(windowId: number, navigationGeneration: number, origin: string): WindowTicket {
        if (this.transportOrigin_ == null) throw new Error('Loopback transport has not started');
        if (origin === '') throw new Error('A window origin is required');

        const ticket = this.createSecret_();
        this.pendingTickets_.set(ticket, {
            expiresAt: Date.now() + ticketLifetimeMs,
            origin,
            windowId,
            navigationGeneration,
        });
        return { ticket, transportOrigin: this.transportOrigin_ };
    }

    onSocket(handler: (connection: AuthenticatedSocket) => void): () => void {
        this.socketHandlers_.add(handler);
        return () => this.socketHandlers_.delete(handler);
    }

    onServiceRequest(handler: ServiceRequestHandler): () => void {
        this.serviceRequestHandlers_.add(handler);
        return () => this.serviceRequestHandlers_.delete(handler);
    }

    revokeWindow(windowId: number): void {
        for (const [ticket, pending] of this.pendingTickets_) {
            if (pending.windowId === windowId) this.pendingTickets_.delete(ticket);
        }
        for (const [token, credential] of this.credentialsByToken_) {
            if (credential.windowId === windowId) this.credentialsByToken_.delete(token);
        }
        const sockets = this.socketsByWindowId_.get(windowId);
        if (sockets != null) {
            for (const socket of sockets) socket.close(1008, 'Window navigation revoked');
            this.socketsByWindowId_.delete(windowId);
        }
    }

    async close(): Promise<void> {
        const server = this.server_;
        const socketServer = this.socketServer_;
        this.server_ = null;
        this.socketServer_ = null;
        this.transportOrigin_ = null;
        this.pendingTickets_.clear();
        this.credentialsByToken_.clear();
        for (const sockets of this.socketsByWindowId_.values()) {
            for (const socket of sockets) socket.close(1001, 'Transport shutting down');
        }
        this.socketsByWindowId_.clear();

        if (socketServer != null) socketServer.close();
        if (server != null) {
            await new Promise<void>((resolve, reject) => {
                server.close(error => error == null ? resolve() : reject(error));
            });
        }
    }

    private handleHttpRequest_(request: IncomingMessage, response: ServerResponse): void {
        if (!this.isExpectedHost_(request)) {
            this.sendJson_(response, 400, { error: 'Invalid Host header' });
            return;
        }

        if (request.method === 'OPTIONS' && (request.url === bootstrapPath || request.url!.startsWith(servicePathPrefix))) {
            const origin = request.headers.origin;
            if (origin == null || (!this.hasPendingOrigin_(origin) && !this.hasCredentialOrigin_(origin))) {
                this.sendJson_(response, 403, { error: 'Origin is not authorized' });
                return;
            }
            this.setCorsHeaders_(response, origin);
            const requestedHeaders = request.headers['access-control-request-headers'];
            if (requestedHeaders != null) response.setHeader('Access-Control-Allow-Headers', requestedHeaders);
            if (request.headers['access-control-request-private-network'] === 'true') {
                response.setHeader('Access-Control-Allow-Private-Network', 'true');
            }
            response.statusCode = 204;
            response.end();
            return;
        }

        if (request.url != null && request.url.startsWith(servicePathPrefix)) {
            void this.handleServiceRequest_(request, response);
            return;
        }

        if (request.method !== 'POST' || request.url !== bootstrapPath) {
            this.sendJson_(response, 404, { error: 'Not found' });
            return;
        }

        this.readJsonBody_(request, (error, body) => {
            if (error != null || body == null || typeof body.ticket !== 'string') {
                this.sendJson_(response, 400, { error: error || 'Invalid bootstrap request' });
                return;
            }
            const pending = this.pendingTickets_.get(body.ticket);
            this.pendingTickets_.delete(body.ticket);
            if (pending == null || pending.expiresAt < Date.now()) {
                this.sendJson_(response, 401, { error: 'Ticket is invalid or expired' });
                return;
            }
            if (request.headers.origin !== pending.origin) {
                this.sendJson_(response, 403, { error: 'Origin does not match the ticket' });
                return;
            }

            const token = this.createSecret_();
            this.credentialsByToken_.set(token, { ...pending, token });
            this.setCorsHeaders_(response, pending.origin);
            this.sendJson_(response, 200, {
                token,
                socketUrl: `${this.transportOrigin_!.replace(/^http/, 'ws')}${socketPath}`,
                windowId: pending.windowId,
                navigationGeneration: pending.navigationGeneration,
            });
        });
    }

    private async handleServiceRequest_(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const origin = request.headers.origin;
        const authorization = request.headers.authorization;
        const token = authorization != null && authorization.startsWith('Bearer ')
            ? authorization.substring('Bearer '.length)
            : null;
        const credential = token == null ? null : this.findCredential_(token);
        if (credential == null || origin !== credential.origin) {
            this.sendJson_(response, 401, { error: 'Service request authentication failed' });
            return;
        }

        const requestUrl = new URL(request.url!, this.transportOrigin_!);
        const encodedServicePath = requestUrl.pathname.substring(servicePathPrefix.length);
        const slashIndex = encodedServicePath.indexOf('/');
        const encodedServiceName = slashIndex < 0 ? encodedServicePath : encodedServicePath.substring(0, slashIndex);
        const servicePath = slashIndex < 0 ? '/' : encodedServicePath.substring(slashIndex);
        let serviceName: string;
        try {
            serviceName = decodeURIComponent(encodedServiceName);
        }
        catch (_) {
            this.sendJson_(response, 400, { error: 'Invalid service name' });
            return;
        }
        if (!isValidServiceName(serviceName)) {
            this.sendJson_(response, 400, { error: 'Invalid service name' });
            return;
        }

        const abortController = new AbortController();
        request.once('aborted', () => abortController.abort());
        let responseFinished = false;
        response.once('finish', () => responseFinished = true);
        response.once('close', () => {
            if (!responseFinished) abortController.abort();
        });
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
            if (name === 'authorization' || name === 'cookie' || value == null) continue;
            if (Array.isArray(value)) {
                for (const item of value) headers.append(name, item);
            }
            else {
                headers.set(name, value);
            }
        }
        const method = request.method || 'GET';
        const init: RequestInit & { duplex?: 'half' } = {
            headers,
            method,
            signal: abortController.signal,
        };
        if (method !== 'GET' && method !== 'HEAD') {
            init.body = Readable.toWeb(request) as ReadableStream;
            init.duplex = 'half';
        }
        const webRequest = new Request(
            `service://${serviceName}${servicePath}${requestUrl.search}`,
            init,
        );
        const context: TransportRequestContext = {
            navigationGeneration: credential.navigationGeneration,
            serviceName,
            windowId: credential.windowId,
        };

        try {
            let serviceResponse: Response | null = null;
            for (const handler of this.serviceRequestHandlers_) {
                serviceResponse = await handler(webRequest, context);
                if (serviceResponse != null) break;
            }
            if (serviceResponse == null) {
                this.setCorsHeaders_(response, credential.origin);
                this.sendJson_(response, 404, { error: `Service not found: ${serviceName}` });
                return;
            }

            response.statusCode = serviceResponse.status;
            response.statusMessage = serviceResponse.statusText;
            serviceResponse.headers.forEach((value, name) => {
                if (!responseHeadersManagedByTransport.has(name)) response.setHeader(name, value);
            });
            this.setCorsHeaders_(response, credential.origin);
            response.setHeader('Access-Control-Expose-Headers', '*');
            if (serviceResponse.body == null) {
                response.end();
                return;
            }
            Readable.fromWeb(serviceResponse.body as any).once('error', () => response.destroy()).pipe(response);
        }
        catch (error) {
            if (response.headersSent) {
                response.destroy();
            }
            else {
                this.setCorsHeaders_(response, credential.origin);
                this.sendJson_(response, 500, {
                    error: error instanceof Error ? error.message : 'Service request failed',
                });
            }
        }
    }

    private authenticateSocket_(socket: WebSocket, request: IncomingMessage): void {
        const origin = request.headers.origin;
        const timeout = setTimeout(() => socket.close(1008, 'Authentication timed out'), authenticationTimeoutMs);
        socket.once('message', data => {
            clearTimeout(timeout);
            let token: string | null = null;
            try {
                const frame = decodeTransportFrame(data.toString());
                if (frame.type === 'authenticate') token = frame.token;
            }
            catch (error) {
                socket.close(1002, 'Invalid transport frame');
                return;
            }

            const credential = token == null ? null : this.findCredential_(token);
            if (credential == null || origin !== credential.origin) {
                socket.close(1008, 'Authentication failed');
                return;
            }

            let sockets = this.socketsByWindowId_.get(credential.windowId);
            if (sockets == null) {
                sockets = new Set<WebSocket>();
                this.socketsByWindowId_.set(credential.windowId, sockets);
            }
            sockets.add(socket);
            socket.once('close', () => {
                sockets!.delete(socket);
                if (sockets!.size === 0) this.socketsByWindowId_.delete(credential.windowId);
            });
            socket.send(encodeTransportFrame({
                type: 'authenticated',
                windowId: credential.windowId,
                navigationGeneration: credential.navigationGeneration,
            }));
            for (const handler of this.socketHandlers_) {
                handler({
                    socket,
                    windowId: credential.windowId,
                    navigationGeneration: credential.navigationGeneration,
                });
            }
        });
    }

    private findCredential_(providedToken: string): WindowCredential | null {
        for (const [token, credential] of this.credentialsByToken_) {
            const expected = Buffer.from(token);
            const provided = Buffer.from(providedToken);
            if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
                return credential;
            }
        }
        return null;
    }

    private hasPendingOrigin_(origin: string): boolean {
        const now = Date.now();
        for (const [ticket, pending] of this.pendingTickets_) {
            if (pending.expiresAt < now) {
                this.pendingTickets_.delete(ticket);
            }
            else if (pending.origin === origin) {
                return true;
            }
        }
        return false;
    }

    private hasCredentialOrigin_(origin: string): boolean {
        for (const credential of this.credentialsByToken_.values()) {
            if (credential.origin === origin) return true;
        }
        return false;
    }

    private isExpectedHost_(request: IncomingMessage): boolean {
        if (this.transportOrigin_ == null) return false;
        return request.headers.host === this.transportOrigin_.substring('http://'.length);
    }

    private setCorsHeaders_(response: ServerResponse, origin: string): void {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
        response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
        response.setHeader('Vary', 'Origin');
    }

    private sendJson_(response: ServerResponse, statusCode: number, body: object): void {
        response.statusCode = statusCode;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(body));
    }

    private readJsonBody_(request: IncomingMessage, callback: (error: string | null, body?: any) => void): void {
        let completed = false;
        let size = 0;
        const chunks: Buffer[] = [];
        const complete = (error: string | null, body?: any) => {
            if (completed) return;
            completed = true;
            callback(error, body);
        };
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximumBootstrapBodyBytes) {
                complete('Bootstrap request is too large');
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (completed) return;
            try {
                complete(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch (_) {
                complete('Bootstrap request is not valid JSON');
            }
        });
        request.on('error', error => complete(error.message));
    }

    private createSecret_(): string {
        return randomBytes(32).toString('base64url');
    }
}

export const loopbackTransport = new LoopbackTransport();