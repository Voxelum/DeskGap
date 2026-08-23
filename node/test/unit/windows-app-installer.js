const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-app-installer-'));
const outputFile = path.join(outputDirectory, 'windows-app-installer.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/windows-app-installer.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

let supported = true;
let updateStatus = 2;
let installOperation;
const nativeCalls = [];
global.__embedder_mod = {
    windowsAppInstallerNative: {
        isSupported: () => supported,
        async getPackageIdentity() {
            return { appInstallerUri: 'https://example.com/app.appinstaller', familyName: 'family', fullName: 'full', name: 'app', publisherId: 'publisher', version: '1.2.3.4' };
        },
        async checkForUpdates() { return updateStatus; },
        install(uri, options, onProgress) {
            nativeCalls.push([uri, options]);
            let resolve;
            let reject;
            const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
            installOperation = { cancelCalled: false, onProgress, resolve, reject };
            return { promise, cancel() { installOperation.cancelCalled = true; reject(new Error('cancelled')); } };
        },
    },
};
const { windowsAppInstaller } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => {
    supported = true;
    updateStatus = 2;
    installOperation = undefined;
    nativeCalls.length = 0;
});

test('reports optional support and packaged identity', async () => {
    assert.equal(windowsAppInstaller.isSupported(), true);
    assert.equal((await windowsAppInstaller.getPackageIdentity()).version, '1.2.3.4');
    supported = false;
    assert.equal(windowsAppInstaller.isSupported(), false);
    assert.equal(await windowsAppInstaller.getPackageIdentity(), null);
    await assert.rejects(windowsAppInstaller.checkForUpdates(), error => error.code === 'ERR_WINDOWS_APP_INSTALLER_UNSUPPORTED');
});

test('maps update availability to stable names', async () => {
    assert.equal(await windowsAppInstaller.checkForUpdates(), 'available');
    updateStatus = 3;
    assert.equal(await windowsAppInstaller.checkForUpdates(), 'required');
    updateStatus = 99;
    await assert.rejects(windowsAppInstaller.checkForUpdates(), /unknown update availability/);
});

test('validates installer URIs and forwards progress', async () => {
    await assert.rejects(windowsAppInstaller.install('relative.appinstaller'), /absolute/);
    await assert.rejects(windowsAppInstaller.install('javascript:alert(1)'), /protocol/);
    await assert.rejects(windowsAppInstaller.install('http://example.com/app.appinstaller'), /protocol/);
    const progress = [];
    const pending = windowsAppInstaller.install('https://example.com/app.appinstaller', {
        forceTargetApplicationShutdown: true,
        installAllResources: true,
        onProgress: value => progress.push(value),
    });
    installOperation.onProgress(0, -1);
    installOperation.onProgress(1, 125);
    installOperation.resolve();
    await pending;
    assert.deepEqual(nativeCalls, [['https://example.com/app.appinstaller', 0x60]]);
    assert.deepEqual(progress, [
        { state: 'queued', percent: 0 },
        { state: 'processing', percent: 100 },
    ]);
});

test('cancels native installation through AbortSignal', async () => {
    const controller = new AbortController();
    const pending = windowsAppInstaller.install('file:///C:/Temp/app.appinstaller', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(installOperation.cancelCalled, true);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await assert.rejects(
        windowsAppInstaller.install('https://example.com/app.appinstaller', { signal: alreadyAborted.signal }),
        error => error.name === 'AbortError',
    );
});