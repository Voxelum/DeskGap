const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-browser-service-'));
const outputFile = path.join(outputDirectory, 'preload.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/ui/preload.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'browser',
    target: 'es2015',
});

const ticket = {
    ticket: 'window-ticket',
    transportOrigin: 'http://127.0.0.1:45678',
};
const bootstrap = {
    navigationGeneration: 2,
    socketUrl: 'ws://127.0.0.1:45678/__deskgap/socket',
    token: 'window-token',
    windowId: 9,
};
const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;
const originalWindow = global.window;

let serviceRequest;
let serviceResponseFactory = null;
let storedBootstrap;
let removedBootstrap = false;

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances = [];
    readyState = MockWebSocket.OPEN;
    bufferedAmount = 0;
    listeners = new Map();
    sentFrames = [];

    constructor(url) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    addEventListener(name, listener) {
        this.listeners.set(name, listener);
    }

    send(data) {
        this.sent = data;
        this.sentFrames.push(data);
    }

    close(code, reason) {
        this.closeCode = code;
        this.closeReason = reason;
    }
}

async function mockFetch(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/__deskgap/bootstrap')) {
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), { ticket: ticket.ticket });
        return Response.json(bootstrap);
    }
    serviceRequest = { input, init };
    if (serviceResponseFactory != null) return serviceResponseFactory(input, init);
    return new Response('service-response', { status: 202 });
}

test.before(async () => {
    global.fetch = mockFetch;
    global.WebSocket = MockWebSocket;
    global.window = {
        deskgap: {
            platform: 'linux',
        },
        fetch: mockFetch,
        history: {
            replaceState(_state, _title, url) {
                global.window.location.href = url;
                global.window.location.hash = '';
            },
        },
        location: {
            hash: `#__deskgap_transport=${encodeURIComponent(JSON.stringify(ticket))}`,
            href: `deskgap-local://app-test.deskgap.test/index.html#__deskgap_transport=${encodeURIComponent(JSON.stringify(ticket))}`,
        },
        sessionStorage: {
            getItem() { return null; },
            removeItem() { removedBootstrap = true; },
            setItem(_key, value) { storedBootstrap = value; },
        },
    };
    require(outputFile);
    await new Promise(resolve => setImmediate(resolve));
});

test.after(() => {
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
    global.window = originalWindow;
    fs.rmSync(outputDirectory, { force: true, recursive: true });
});

test('rewrites service URLs and attaches the scoped bearer token', async () => {
    const controller = new AbortController();
    const sourceRequest = new Request('service://launcher/upload?kind=mod', {
        body: 'request-body',
        headers: { 'X-Launcher': 'test' },
        method: 'POST',
        signal: controller.signal,
        duplex: 'half',
    });
    const response = await global.window.deskgap.fetch(sourceRequest);

    assert.equal(response.status, 202);
    assert.equal(await response.text(), 'service-response');
    assert.equal(serviceRequest.input, 'http://127.0.0.1:45678/__deskgap/service/launcher/upload?kind=mod');
    assert.equal(serviceRequest.init.method, 'POST');
    assert.equal(serviceRequest.init.headers.get('Authorization'), 'Bearer window-token');
    assert.equal(serviceRequest.init.headers.get('X-Launcher'), 'test');
    assert.equal(serviceRequest.init.signal.aborted, false);
    controller.abort();
    assert.equal(serviceRequest.init.signal.aborted, true);
    assert.equal(await new Response(serviceRequest.init.body).text(), 'request-body');
    assert.equal(removedBootstrap, true);
    assert.deepEqual(JSON.parse(storedBootstrap), bootstrap);
});

test('rejects non-service URLs', async () => {
    await assert.rejects(
        global.window.deskgap.fetch('https://example.com/'),
        /only accepts service: URLs/,
    );
});

test('rejects ambiguous service authorities', async () => {
    await assert.rejects(
        global.window.deskgap.fetch('service://user@launcher/path'),
        /credentials/,
    );
    await assert.rejects(
        global.window.deskgap.fetch('service://launcher:1234/path'),
        /without credentials or a port/,
    );
});

test('invokes a named handler over the authenticated service transport', async () => {
    serviceResponseFactory = () => Response.json({ value: { accepted: true } });
    try {
        const result = await global.window.deskgap.invoke('launcher.install', { version: '1.20.1' });
        assert.deepEqual(result, { accepted: true });
        assert.equal(serviceRequest.input, 'http://127.0.0.1:45678/__deskgap/service/deskgap.invoke/launcher.install');
        assert.equal(serviceRequest.init.method, 'POST');
        assert.equal(serviceRequest.init.headers.get('Authorization'), 'Bearer window-token');
        assert.equal(serviceRequest.init.headers.get('Content-Type'), 'application/json');
        assert.deepEqual(JSON.parse(await new Response(serviceRequest.init.body).text()), {
            args: { version: '1.20.1' },
        });
    }
    finally {
        serviceResponseFactory = null;
    }
});

test('reconstructs structured invoke errors without exposing a remote stack', async () => {
    serviceResponseFactory = () => Response.json({
        error: {
            code: 'VERSION_MISSING',
            details: { version: '1.20.1' },
            message: 'Version is not installed',
            name: 'InstallError',
        },
    }, { status: 500 });
    try {
        await assert.rejects(
            global.window.deskgap.invoke('launcher.play', null),
            error => {
                assert.equal(error.name, 'InvokeError');
                assert.equal(error.remoteName, 'InstallError');
                assert.equal(error.message, 'Version is not installed');
                assert.equal(error.code, 'VERSION_MISSING');
                assert.deepEqual(error.details, { version: '1.20.1' });
                assert.equal(error.stack.includes('remote'), false);
                return true;
            },
        );
    }
    finally {
        serviceResponseFactory = null;
    }
});

test('validates invoke values and propagates cancellation', async () => {
    await assert.rejects(
        global.window.deskgap.invoke('launcher.invalid', { callback() {} }),
        /JSON-compatible/,
    );

    serviceResponseFactory = (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const controller = new AbortController();
    try {
        const invoking = global.window.deskgap.invoke('launcher.wait', null, { signal: controller.signal });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(serviceRequest.init.signal.aborted, false);
        controller.abort(new Error('cancelled by test'));
        await assert.rejects(invoking, /cancelled by test/);
        assert.equal(serviceRequest.init.signal.aborted, true);
    }
    finally {
        serviceResponseFactory = null;
    }
});

test('delivers metadata-only native file drop events', () => {
    const received = [];
    const unsubscribe = global.window.deskgap.onFilesDropped(event => received.push(event.entries));
    const socket = MockWebSocket.instances[0];
    socket.listeners.get('message')({
        data: JSON.stringify({
            version: 1,
            type: 'authenticated',
            windowId: bootstrap.windowId,
            navigationGeneration: bootstrap.navigationGeneration,
        }),
    });
    socket.listeners.get('message')({
        data: JSON.stringify({
            version: 1,
            type: 'native-file-drop',
            entries: [
                { handle: 'dgfile_capability', kind: 'file', name: 'pack.zip', size: 42 },
                { handle: 'dgfile_directory', kind: 'directory', name: 'mods', size: null },
                { handle: 123, kind: 'file', name: 'invalid', size: 0 },
            ],
        }),
    });

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], [
        { handle: 'dgfile_capability', kind: 'file', name: 'pack.zip', size: 42 },
        { handle: 'dgfile_directory', kind: 'directory', name: 'mods', size: null },
    ]);
    assert.equal(JSON.stringify(received).includes('C:\\'), false);

    unsubscribe();
    socket.listeners.get('message')({
        data: JSON.stringify({
            version: 1,
            type: 'native-file-drop',
            entries: [{ handle: 'dgfile_other', kind: 'file', name: 'other.jar', size: 1 }],
        }),
    });
    assert.equal(received.length, 1);
});

test('rejects an authenticated frame for another navigation', () => {
    const activeSocket = MockWebSocket.instances[0];
    activeSocket.listeners.get('message')({
        data: JSON.stringify({
            version: 1,
            type: 'authenticated',
            windowId: bootstrap.windowId,
            navigationGeneration: bootstrap.navigationGeneration + 1,
        }),
    });
    assert.equal(activeSocket.closeCode, 1008);
    assert.equal(activeSocket.closeReason, 'Window identity mismatch');
});

test('opens a binary channel and returns credit when data is consumed', async () => {
    const socket = MockWebSocket.instances[0];
    let opened;
    global.window.deskgap.onChannel(event => { opened = event.channel; });
    socket.listeners.get('message')({
        data: JSON.stringify({ version: 1, type: 'channel-open', channelId: 9 }),
    });
    assert.equal(opened.id, 9);
    assert.deepEqual(JSON.parse(socket.sentFrames.at(-1)), {
        version: 1,
        type: 'channel-credit',
        channelId: 9,
        bytes: 256 * 1024,
    });

    const reader = opened.readable.getReader();
    const reading = reader.read();
    const frame = new Uint8Array(11);
    frame.set([0x44, 0x47, 1, 1]);
    new DataView(frame.buffer).setUint32(4, 9, true);
    frame.set([4, 5, 6], 8);
    socket.listeners.get('message')({ data: frame.buffer });
    assert.deepEqual(Array.from((await reading).value), [4, 5, 6]);
    assert.deepEqual(JSON.parse(socket.sentFrames.at(-1)), {
        version: 1,
        type: 'channel-credit',
        channelId: 9,
        bytes: 3,
    });
});

test('reconnects after a transient close and stops after authorization failure', async () => {
    const originalCount = MockWebSocket.instances.length;
    const activeSocket = MockWebSocket.instances[0];
    activeSocket.listeners.get('close')({ code: 1006 });
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(MockWebSocket.instances.length, originalCount + 1);
    const reconnected = MockWebSocket.instances.at(-1);
    reconnected.listeners.get('open')();
    assert.deepEqual(JSON.parse(reconnected.sent), {
        version: 1,
        type: 'authenticate',
        token: bootstrap.token,
    });
    reconnected.listeners.get('close')({ code: 1008 });
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(MockWebSocket.instances.length, originalCount + 1);
});