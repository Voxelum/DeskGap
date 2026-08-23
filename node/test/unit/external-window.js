const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-external-window-'));
const outputFile = path.join(outputDirectory, 'external-window.cjs');
buildSync({
    bundle: true,
    define: { 'process.platform': '"win32"' },
    entryPoints: [path.resolve(__dirname, '../../js/node/external-window.ts')],
    external: ['./app'],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

let supported = true;
let operation;
const calls = [];
fs.writeFileSync(path.join(outputDirectory, 'app.js'), 'exports.app = { isReady() { return global.__deskgapAppReady !== false } };');
global.__embedder_mod = {
    externalWindowNative: {
        isSupported: () => supported,
        moveAndResize(...args) {
            calls.push(args);
            let resolve;
            let reject;
            const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
            operation = { resolve, reject, cancelCalled: false };
            return { promise, cancel() { operation.cancelCalled = true; reject(new Error('cancelled')); } };
        },
    },
};
const { externalWindow } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => { supported = true; operation = undefined; calls.length = 0; global.__deskgapAppReady = true; });

test('validates process, bounds, timeout, and support before native calls', async () => {
    await assert.rejects(externalWindow.moveAndResize(0, { x: 0, y: 0, width: 1, height: 1 }), /processId/);
    await assert.rejects(externalWindow.moveAndResize(1, { x: 0, y: 0, width: 0, height: 1 }), /bounds/);
    await assert.rejects(externalWindow.moveAndResize(1, { x: 0, y: 0, width: 1, height: 1 }, { timeout: -1 }), /timeout/);
    supported = false;
    await assert.rejects(
        externalWindow.moveAndResize(1, { x: 0, y: 0, width: 1, height: 1 }),
        error => error.code === 'ERR_EXTERNAL_WINDOW_UNSUPPORTED',
    );
    supported = true;
    global.__deskgapAppReady = false;
    await assert.rejects(externalWindow.moveAndResize(1, { x: 0, y: 0, width: 1, height: 1 }), /app readiness/);
    assert.deepEqual(calls, []);
});

test('forwards normalized geometry and coordinate space', async () => {
    const pending = externalWindow.moveAndResize(42, { x: 10.5, y: -2.5, width: 800, height: 600 }, { timeout: 1234 });
    operation.resolve();
    await pending;
    assert.deepEqual(calls, [[42, 10.5, -2.5, 800, 600, 1234, true]]);
});

test('cancels native operation through AbortSignal', async () => {
    const controller = new AbortController();
    const pending = externalWindow.moveAndResize(42, { x: 0, y: 0, width: 1, height: 1 }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(operation.cancelCalled, true);
});