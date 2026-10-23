const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { build } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-session-unit-'));
const outputFile = path.join(outputDirectory, 'session.cjs');
let session;

test.before(async () => {
    await build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '../../js/node/session.ts')],
        format: 'cjs',
        outfile: outputFile,
        platform: 'node',
        target: 'node24',
        plugins: [{
            name: 'mock-app',
            setup(build) {
                build.onResolve({ filter: /^\.\/app$/ }, args =>
                    args.importer.endsWith('session.ts') ? { path: 'app', namespace: 'mock' } : null
                );
                build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
                    contents: `export const app = { getPath(name) { return name === 'temp' ? ${JSON.stringify(os.tmpdir())} : ${JSON.stringify(outputDirectory)} } }`,
                    loader: 'js',
                }));
            },
        }],
    });
    ({ session } = require(outputFile));
});

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('reuses default, named, and partition sessions with correct persistence', () => {
    assert.equal(session.defaultSession.kind, 'default');
    assert.equal(session.fromName('shared'), session.fromName('shared'));
    assert.equal(session.fromName('shared').kind, 'persistent');
    assert.equal(session.fromPartition('persist:shared'), session.fromName('shared'));
    assert.equal(session.fromPartition('temporary'), session.fromPartition('temporary'));
    assert.equal(session.fromPartition('temporary').kind, 'ephemeral');
    assert.notEqual(session.createEphemeral(), session.createEphemeral());
});

test('macOS named-session availability uses Darwin version and preserves identity', async () => {
    // Boundary simulation tests JS validation, not the installed WebKit runtime.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalRelease = os.release;
    try {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        os.release = () => '22.6.0';
        const old = session.fromName('old-macos');
        assert.throws(() => old.acquire(null), /require macOS 14 or later/);
        old.setUserAgent('still-mutable'); // Failed acquisition must not lock configuration.
        assert.equal(session.defaultSession.acquire(null).kind, 'default');
        assert.equal(session.createEphemeral().acquire(null).kind, 'ephemeral');
        for (const version of ['23.0.0', '24.6.0', '25.0.0']) {
            os.release = () => version;
            const shared = session.fromName(`mac-${version}`);
            assert.equal(session.fromPartition(`persist:mac-${version}`), shared);
            const options = shared.acquire(null);
            assert.equal(options.kind, 'persistent');
            assert.equal(options.id, `persistent:mac-${version}`);
            assert.equal(shared.acquire(null).id, options.id);
            assert.notEqual(session.fromName(`mac-${version}-other`).acquire(null).id, options.id);
        }
        const proxy = session.fromName('mac-proxy');
        await proxy.setProxy({ mode: 'direct' });
        assert.throws(() => proxy.acquire(null), /does not support per-session proxy/);
    }
    finally {
        os.release = originalRelease;
        Object.defineProperty(process, 'platform', platform);
    }
});

test('freezes user-agent and proxy configuration after first attachment', async () => {
    const value = session.createEphemeral();
    value.setUserAgent('DeskGapSessionTest/1.0');
    await value.setProxy({ proxyRules: 'http://localhost:8080', proxyBypassRules: 'localhost' });
    const engine = process.platform === 'win32' ? 'webview2' : null;
    if (process.platform === 'darwin') {
        assert.throws(() => value.acquire(engine), /WKWebView does not support per-session proxy/);
        await value.setProxy({ mode: 'system' });
    }
    const native = value.acquire(engine);
    assert.equal(native.userAgent, 'DeskGapSessionTest/1.0');
    assert.equal(native.proxyRules, process.platform === 'darwin' ? null : 'http://localhost:8080');
    assert.deepEqual(native.customSchemes, []);
    assert.throws(() => value.setUserAgent('changed'), /cannot be changed/);
    await assert.rejects(value.setProxy({ mode: 'direct' }), /cannot be changed/);
});

test('registers and dispatches bounded custom protocols', async () => {
    const value = session.createEphemeral();
    const remove = value.protocol.handle('launcher-assets', async (request, context) => {
        assert.equal(context.session, value);
        assert.equal(context.signal.aborted, false);
        assert.equal(request.url, 'launcher-assets://app/config.json');
        assert.equal(request.headers.get('x-test'), 'protocol');
        return Response.json({ enabled: true }, { status: 201, statusText: 'Created' });
    });
    assert.equal(value.protocol.isProtocolHandled('launcher-assets'), true);
    const native = value.acquire('webview2');
    assert.deepEqual(native.customSchemes, [{ scheme: 'launcher-assets' }]);
    const response = await value.dispatchProtocolRequest({
        body: null,
        headers: [['X-Test', 'protocol']],
        method: 'GET',
        url: 'launcher-assets://app/config.json',
    }, new AbortController().signal);
    assert.equal(response.statusCode, 201);
    assert.equal(response.statusText, 'Created');
    assert.equal(response.headers.some(([name, content]) => name === 'content-type' && content.includes('application/json')), true);
    assert.deepEqual(JSON.parse(response.body.toString()), { enabled: true });

    const methodNotAllowed = await value.dispatchProtocolRequest({
        body: Buffer.from('ignored'),
        headers: [],
        method: 'POST',
        url: 'launcher-assets://app/config.json',
    }, new AbortController().signal);
    assert.equal(methodNotAllowed.statusCode, 405);
    assert.deepEqual(methodNotAllowed.headers, [['allow', 'GET, HEAD']]);
    assert.throws(remove, /cannot be changed/);
    assert.throws(() => value.protocol.unhandle('launcher-assets'), /cannot be changed/);
});

test('validates custom protocol registration and handler results', async () => {
    const value = session.createEphemeral();
    for (const scheme of ['https', 'service', 'deskgap-test', 'Uppercase', '1invalid']) {
        assert.throws(() => value.protocol.handle(scheme, () => new Response()), /Protocol scheme/);
    }
    value.protocol.handle('test-app', () => ({ body: 'invalid' }));
    assert.throws(() => value.protocol.handle('test-app', () => new Response()), /already has a handler/);
    await assert.rejects(value.dispatchProtocolRequest({
        body: null,
        headers: [],
        method: 'GET',
        url: 'test-app://host/path',
    }, new AbortController().signal), /must return a Response/);

    const winrt = session.createEphemeral();
    winrt.protocol.handle('test-winrt', () => new Response());
    assert.throws(() => winrt.acquire('winrt'), /custom protocols/);
});

test('rejects custom protocol URLs without an authority before dispatch', async () => {
    const value = session.createEphemeral();
    let called = false;
    value.protocol.handle('test-authority', () => {
        called = true;
        return new Response();
    });
    const response = await value.dispatchProtocolRequest({
        body: null,
        headers: [],
        method: 'GET',
        url: 'test-authority:path',
    }, new AbortController().signal);
    assert.equal(response.statusCode, 400);
    assert.equal(called, false);
});

test('normalizes empty response status text and strips HEAD bodies', async () => {
    const value = session.createEphemeral();
    value.protocol.handle('test-head', () => new Response('not returned'));
    const response = await value.dispatchProtocolRequest({
        body: null,
        headers: [],
        method: 'HEAD',
        url: 'test-head://host/path',
    }, new AbortController().signal);
    assert.equal(response.statusCode, 200);
    assert.equal(response.statusText, 'OK');
    assert.equal(response.body.byteLength, 0);
});

test('Session.fetch uses custom protocol handlers unless bypassed', async () => {
    const value = session.createEphemeral();
    value.protocol.handle('test-fetch', request => Response.json({ url: request.url }));
    const response = await value.fetch('test-fetch://host/path');
    assert.deepEqual(await response.json(), { url: 'test-fetch://host/path' });
    await assert.rejects(
        value.fetch('test-fetch://host/path', { bypassCustomProtocolHandlers: true }),
        error => /unknown scheme/i.test(error.cause?.message),
    );
});

test('rejects unsupported engines and unsafe proxy arguments', async () => {
    const configured = session.createEphemeral();
    assert.throws(() => configured.acquire('winrt'), /does not support explicit sessions/);
    const value = session.createEphemeral();
    await assert.rejects(value.setProxy({ proxyRules: 'http://proxy\" --no-proxy-server' }), /quotes/);
});

test('fetch applies the session user agent and streams responses', async () => {
    const server = http.createServer((request, response) => {
        assert.equal(request.headers['user-agent'], 'DeskGapFetchTest/1.0');
        response.write('stream-');
        response.end('response');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const value = session.createEphemeral();
    value.setUserAgent('DeskGapFetchTest/1.0');
    try {
        const response = await value.fetch(`http://127.0.0.1:${server.address().port}/`);
        assert.equal(await response.text(), 'stream-response');
    }
    finally {
        await value.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('fetch routes through a fixed proxy and rejects complex Chromium rules', async () => {
    let proxyTarget;
    const proxy = http.createServer((request, response) => {
        proxyTarget = request.url;
        response.setHeader('Connection', 'close');
        response.end('proxied');
    });
    await new Promise((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(0, '127.0.0.1', resolve);
    });
    const value = session.createEphemeral();
    await value.setProxy({ proxyRules: `http://127.0.0.1:${proxy.address().port}` });
    try {
        const response = await value.fetch('http://deskgap-proxy.test/path?q=1');
        assert.equal(await response.text(), 'proxied');
        assert.equal(proxyTarget, 'http://deskgap-proxy.test/path?q=1');
    }
    finally {
        await value.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
    }

    const unsupported = session.createEphemeral();
    await unsupported.setProxy({ proxyRules: 'http=localhost:8080;https=localhost:8443' });
    await assert.rejects(unsupported.fetch('http://example.test/'), /simple http/);
});

test('fetch propagates cancellation', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const value = session.createEphemeral();
    const controller = new AbortController();
    const pending = value.fetch(`http://127.0.0.1:${server.address().port}/`, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    await value.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

test('native macOS store identity includes normalized profile and full session id', {
    skip: process.platform !== 'darwin' ? 'requires Foundation and the macOS compiler' : false,
}, () => {
    // Compile the production helper verbatim, without loading WebKit or creating stores.
    const { execFileSync } = require('node:child_process');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../lib/src/platform/mac/webview.mm'), 'utf8');
    const helper = source.split('// BEGIN persistent-store-identity')[1]
        .split('// END persistent-store-identity')[0].replace(/^.*\n/, '');
    const input = path.join(outputDirectory, 'store-identity.mm');
    const executable = path.join(outputDirectory, 'store-identity');
    fs.writeFileSync(input, `
#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#include <string>
#include <cassert>
NSString* NSStr(const std::string& s) { return [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding]; }
std::string CXXStr(NSString* s) { return std::string(s.UTF8String); }
${helper}
int main(int argc, char** argv) { @autoreleasepool {
    std::string root = argv[1];
    auto same = [](NSUUID* a, NSUUID* b) { return [a isEqual:b]; };
    auto a = PersistentStoreIdentifier("persistent:main", root + "/app-a/profile");
    assert(same(a, PersistentStoreIdentifier("persistent:main", root + "/app-a/profile")));
    assert(same(a, PersistentStoreIdentifier("persistent:main", root + "/app-a/./profile")));
    assert(!same(a, PersistentStoreIdentifier("persistent:main", root + "/app-b/profile")));
    assert(!same(a, PersistentStoreIdentifier("persistent:main", root + "/app-a/other-profile")));
    assert(!same(a, PersistentStoreIdentifier("persistent:other", root + "/app-a/profile")));
    assert(!same(PersistentStoreIdentifier("bc", root + "/a"), PersistentStoreIdentifier("c", root + "/ab")));
    assert(!same(PersistentStoreIdentifier("persistent:名字", root), PersistentStoreIdentifier("persistent:名/字", root)));
    bool rejected = false;
    @try { PersistentStoreIdentifier("persistent:main", ""); }
    @catch (NSException* e) { rejected = true; }
    assert(rejected);
} }
`);
    execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-framework', 'Foundation', input, '-o', executable]);
    execFileSync(executable, [outputDirectory]);
});
