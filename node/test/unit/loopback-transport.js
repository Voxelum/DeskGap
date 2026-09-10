const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');
const WebSocket = require('ws');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-transport-'));
const outputFile = path.join(outputDirectory, 'loopback-transport.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/internal/loopback-transport.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { isValidServiceName, LoopbackTransport } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('validates URL-safe service names', () => {
    assert.equal(isValidServiceName('launcher'), true);
    assert.equal(isValidServiceName('xmcl.v2_api'), true);
    assert.equal(isValidServiceName('Launcher'), false);
    assert.equal(isValidServiceName('launcher/admin'), false);
    assert.equal(isValidServiceName('-launcher'), false);
    assert.equal(isValidServiceName('launcher-'), false);
});

test('shares one in-flight server start between windows', async () => {
    const transport = new LoopbackTransport();
    const firstStart = transport.start();
    const secondStart = transport.start();

    assert.equal(secondStart, firstStart);
    assert.equal(await secondStart, await firstStart);
    await transport.close();
});

test('binds WinRT bootstrap preflight to its exact native local-stream origin', async context => {
    const transport = new LoopbackTransport();
    context.after(() => transport.close());
    const transportOrigin = await transport.start();
    const pageOrigin = 'ms-local-stream://Microsoft.Win32WebViewHost_test_4465736b476170';
    const issued = transport.issueWindowTicket(8, 1, pageOrigin);
    for (const origin of [pageOrigin, 'null', 'ms-local-stream://another-host']) {
        const response = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
        });
        assert.equal(response.status, origin === pageOrigin ? 204 : 403);
        assert.equal(response.headers.get('access-control-allow-origin'), origin === pageOrigin ? pageOrigin : null);
    }
    const response = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), pageOrigin);
});

test('exchanges a window ticket and authenticates one WebSocket', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://host';
    const issued = transport.issueWindowTicket(7, 3, pageOrigin);

    const response = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), pageOrigin);
    const bootstrap = await response.json();

    const connected = new Promise(resolve => transport.onSocket(resolve));
    const socket = new WebSocket(bootstrap.socketUrl, { origin: pageOrigin });
    const authenticated = new Promise((resolve, reject) => {
        socket.once('open', () => socket.send(JSON.stringify({ version: 1, type: 'authenticate', token: bootstrap.token })));
        socket.once('message', data => resolve(JSON.parse(data.toString())));
        socket.once('error', reject);
    });

    assert.deepEqual(await authenticated, {
        version: 1,
        type: 'authenticated',
        windowId: 7,
        navigationGeneration: 3,
    });
    const connection = await connected;
    assert.equal(connection.windowId, 7);
    assert.equal(connection.navigationGeneration, 3);

    socket.close();
    await new Promise(resolve => socket.once('close', resolve));
    const reconnectedSocket = new WebSocket(bootstrap.socketUrl, { origin: pageOrigin });
    const reauthenticated = new Promise((resolve, reject) => {
        reconnectedSocket.once('open', () => reconnectedSocket.send(JSON.stringify({ version: 1, type: 'authenticate', token: bootstrap.token })));
        reconnectedSocket.once('message', data => resolve(JSON.parse(data.toString())));
        reconnectedSocket.once('error', reject);
    });
    assert.equal((await reauthenticated).type, 'authenticated');

    const replay = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    });
    assert.equal(replay.status, 401);

    const closed = new Promise(resolve => reconnectedSocket.once('close', resolve));
    transport.revokeWindow(7);
    await closed;

    const revokedSocket = new WebSocket(bootstrap.socketUrl, { origin: pageOrigin });
    const revoked = new Promise((resolve, reject) => {
        revokedSocket.once('open', () => revokedSocket.send(JSON.stringify({ version: 1, type: 'authenticate', token: bootstrap.token })));
        revokedSocket.once('close', code => resolve(code));
        revokedSocket.once('error', reject);
    });
    assert.equal(await revoked, 1008);
    await transport.close();
});

test('rejects unversioned WebSocket authentication frames', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://host';
    const issued = transport.issueWindowTicket(7, 3, pageOrigin);
    const response = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    });
    const bootstrap = await response.json();
    const socket = new WebSocket(bootstrap.socketUrl, { origin: pageOrigin });
    const closed = new Promise((resolve, reject) => {
        socket.once('open', () => socket.send(JSON.stringify({ type: 'authenticate', token: bootstrap.token })));
        socket.once('close', resolve);
        socket.once('error', reject);
    });
    assert.equal(await closed, 1002);
    await transport.close();
});

test('rejects a bootstrap request from a different origin', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const issued = transport.issueWindowTicket(9, 1, 'deskgap-local://host');

    const response = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
        method: 'POST',
    });
    assert.equal(response.status, 403);
    await transport.close();
});

test('streams authenticated Fetch service requests and responses', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://app-test.deskgap.test';
    const issued = transport.issueWindowTicket(11, 4, pageOrigin);
    const bootstrapResponse = await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    });
    const bootstrap = await bootstrapResponse.json();

    let receivedContext;
    let releaseSecondChunk;
    transport.onServiceRequest(async (request, context) => {
        receivedContext = context;
        assert.equal(request.url, 'service://launcher/upload?kind=test');
        assert.equal(request.headers.get('cookie'), null);
        assert.equal(request.headers.get('x-test'), 'request-header');
        assert.equal(await request.text(), 'request-body');
        let controller;
        const body = new ReadableStream({
            start(value) {
                controller = value;
                value.enqueue(new TextEncoder().encode('first-'));
            },
        });
        releaseSecondChunk = () => {
            controller.enqueue(new TextEncoder().encode('second'));
            controller.close();
        };
        return new Response(body, {
            headers: { 'X-Service': 'launcher' },
            status: 201,
            statusText: 'Created',
        });
    });

    const response = await fetch(`${transportOrigin}/__deskgap/service/launcher/upload?kind=test`, {
        body: 'request-body',
        headers: {
            Authorization: `Bearer ${bootstrap.token}`,
            Cookie: 'unrelated-loopback-state=true',
            Origin: pageOrigin,
            'X-Test': 'request-header',
        },
        method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.equal(response.statusText, 'Created');
    assert.equal(response.headers.get('access-control-allow-origin'), pageOrigin);
    assert.equal(response.headers.get('x-service'), 'launcher');

    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), 'first-');
    releaseSecondChunk();
    const second = await reader.read();
    assert.equal(new TextDecoder().decode(second.value), 'second');
    assert.equal((await reader.read()).done, true);
    assert.deepEqual(receivedContext, {
        navigationGeneration: 4,
        serviceName: 'launcher',
        windowId: 11,
    });
    await transport.close();
});

test('rejects unauthenticated service requests', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const response = await fetch(`${transportOrigin}/__deskgap/service/launcher/test`, {
        headers: { Origin: 'deskgap-local://app-test.deskgap.test' },
    });
    assert.equal(response.status, 401);
    await transport.close();
});

test('rejects encoded service namespace escapes', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://app-test.deskgap.test';
    const issued = transport.issueWindowTicket(14, 1, pageOrigin);
    const bootstrap = await (await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    })).json();

    const response = await fetch(`${transportOrigin}/__deskgap/service/launcher%2Fadmin/test`, {
        headers: { Authorization: `Bearer ${bootstrap.token}`, Origin: pageOrigin },
    });
    assert.equal(response.status, 400);
    await transport.close();
});

test('keeps HTTP framing headers under transport control', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://app-test.deskgap.test';
    const issued = transport.issueWindowTicket(15, 1, pageOrigin);
    const bootstrap = await (await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    })).json();
    transport.onServiceRequest(() => new Response('complete-body', {
        headers: {
            Connection: 'close',
            'Content-Length': '1',
            'Set-Cookie': 'transport-state=unsafe',
            'X-Service': 'launcher',
        },
    }));

    const response = await fetch(`${transportOrigin}/__deskgap/service/launcher/test`, {
        headers: { Authorization: `Bearer ${bootstrap.token}`, Origin: pageOrigin },
    });
    assert.equal(await response.text(), 'complete-body');
    assert.notEqual(response.headers.get('content-length'), '1');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-service'), 'launcher');
    await transport.close();
});

test('authorizes service preflight headers only for the window origin', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'http://app-test.deskgap.test';
    transport.issueWindowTicket(12, 1, pageOrigin);

    const response = await fetch(`${transportOrigin}/__deskgap/service/launcher/test`, {
        headers: {
            'Access-Control-Request-Headers': 'authorization, content-type, x-launcher-request',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Private-Network': 'true',
            Origin: pageOrigin,
        },
        method: 'OPTIONS',
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), pageOrigin);
    assert.equal(response.headers.get('access-control-allow-headers'), 'authorization, content-type, x-launcher-request');
    assert.equal(response.headers.get('access-control-allow-private-network'), 'true');

    const rejected = await fetch(`${transportOrigin}/__deskgap/service/launcher/test`, {
        headers: {
            'Access-Control-Request-Method': 'POST',
            Origin: 'https://attacker.example',
        },
        method: 'OPTIONS',
    });
    assert.equal(rejected.status, 403);
    await transport.close();
});

test('propagates browser cancellation to the service Request signal', async () => {
    const transport = new LoopbackTransport();
    const transportOrigin = await transport.start();
    const pageOrigin = 'deskgap-local://app-test.deskgap.test';
    const issued = transport.issueWindowTicket(13, 2, pageOrigin);
    const bootstrap = await (await fetch(`${transportOrigin}/__deskgap/bootstrap`, {
        body: JSON.stringify({ ticket: issued.ticket }),
        headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
        method: 'POST',
    })).json();

    let serviceSignal;
    let resolveStarted;
    let resolveAborted;
    const started = new Promise(resolve => resolveStarted = resolve);
    const aborted = new Promise(resolve => resolveAborted = resolve);
    transport.onServiceRequest(request => {
        serviceSignal = request.signal;
        request.signal.addEventListener('abort', resolveAborted, { once: true });
        resolveStarted();
        return new Promise(() => {});
    });

    const controller = new AbortController();
    const request = fetch(`${transportOrigin}/__deskgap/service/launcher/wait`, {
        headers: { Authorization: `Bearer ${bootstrap.token}`, Origin: pageOrigin },
        signal: controller.signal,
    });
    await started;
    controller.abort();
    await assert.rejects(request, error => error.name === 'AbortError');
    await Promise.race([
        aborted,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service request was not aborted')), 250)),
    ]);
    assert.equal(serviceSignal.aborted, true);
    await transport.close();
});