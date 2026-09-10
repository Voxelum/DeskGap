const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const test = require('node:test');
const { constants: zlibConstants, createZstdCompress } = require('node:zlib');
const { build } = require('esbuild');
const { pack } = require('tar-stream');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-updater-'));
const outputFile = path.join(outputDirectory, 'updater.cjs');
let Updater;
let serializeUpdateManifestForSignature;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const assetContent = Buffer.from('verified update artifact');
const assetHash = createHash('sha256').update(assetContent).digest('hex');
let servedAsset = assetContent;
let manifestVersion = '1.1.0';
let manifestHash = assetHash;
let assetOverrides = {};
let assetDelay = 0;
let invalidSignature = false;
let chunkedAsset = false;
let additionalAssets = [];
let server;
let origin;

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

test.before(async () => {
    await build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '../../js/node/updater.ts')],
        format: 'cjs',
        outfile: outputFile,
        platform: 'node',
        target: 'node24',
        plugins: [{
            name: 'mock-updater-app',
            setup(build) {
                build.onResolve({ filter: /^\.\/(app|session)$/ }, args => {
                    if (!args.importer.endsWith('updater.ts')) return null;
                    return { path: args.path.substring(2), namespace: 'mock' };
                });
                build.onResolve({ filter: /^\.\/internal\/application-payload$/ }, args => {
                    if (!args.importer.endsWith('updater.ts')) return null;
                    return { path: 'application-payload', namespace: 'mock' };
                });
                build.onLoad({ filter: /^app$/, namespace: 'mock' }, () => ({
                    contents: `export const app = { getVersion() { return '1.0.0' }, getPath() { return ${JSON.stringify(outputDirectory)} }, exit() { throw new Error('exit should not run in unit tests') } }`,
                    loader: 'js',
                }));
                build.onLoad({ filter: /^session$/, namespace: 'mock' }, () => ({
                    contents: `export class Session {}; export const session = { defaultSession: null }`,
                    loader: 'js',
                }));
                build.onLoad({ filter: /^application-payload$/, namespace: 'mock' }, () => ({
                    contents: `export function getApplicationPayloadRoot() { return ${JSON.stringify(path.join(outputDirectory, 'application'))} }; export const payloadCompletionFileName = '.deskgap-payload.json'; export const runtimeApiVersion = 1;`,
                    loader: 'js',
                }));
            },
        }],
    });
    ({ Updater, serializeUpdateManifestForSignature } = require(outputFile));

    server = http.createServer(async (request, response) => {
        if (request.url === '/manifest.json') {
            const unsigned = {
                version: manifestVersion,
                releaseNotes: 'notes',
                assets: [{
                    arch: process.arch,
                    name: process.platform === 'win32' ? 'update.exe' : 'update.bin',
                    platform: process.platform,
                    sha256: manifestHash,
                    size: assetContent.length,
                    url: '/asset',
                    ...assetOverrides,
                }, ...additionalAssets],
            };
            const signature = sign(null, Buffer.from(serializeUpdateManifestForSignature(unsigned)), privateKey).toString('base64');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ...unsigned, signature: invalidSignature ? `${signature.substring(0, signature.length - 4)}AAAA` : signature }));
            return;
        }
        if (request.url === '/asset') {
            if (assetDelay > 0) await new Promise(resolve => setTimeout(resolve, assetDelay));
            if (chunkedAsset) response.write(servedAsset.subarray(0, 1));
            else response.setHeader('content-length', servedAsset.length);
            response.end(chunkedAsset ? servedAsset.subarray(1) : servedAsset);
            return;
        }
        response.statusCode = 404;
        response.end();
    });
    await listen(server);
    origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(outputDirectory, { force: true, recursive: true });
});

test.beforeEach(() => {
    manifestVersion = '1.1.0';
    manifestHash = assetHash;
    servedAsset = assetContent;
    assetOverrides = {};
    assetDelay = 0;
    invalidSignature = false;
    chunkedAsset = false;
    additionalAssets = [];
});

function createUpdater(options = {}) {
    return new Updater({
        allowLoopback: true,
        session: { fetch: (input, init) => fetch(input, init) },
        trustedPublicKey: publicKey.export({ format: 'pem', type: 'spki' }),
        ...options,
    });
}

async function createApplicationPayload(entries) {
    const archive = pack();
    const chunks = [];
    const compressed = archive.pipe(createZstdCompress({
        params: { [zlibConstants.ZSTD_c_compressionLevel]: 3 },
    }));
    compressed.on('data', chunk => chunks.push(chunk));
    for (const [name, content] of entries) {
        await new Promise((resolve, reject) => {
            archive.entry({ name, size: content.length, type: 'file' }, content, error => error ? reject(error) : resolve());
        });
    }
    archive.finalize();
    await finished(compressed);
    return Buffer.concat(chunks);
}

test('checks, streams, verifies, and atomically stores an update', async () => {
    const updater = createUpdater();
    const events = [];
    updater.on('checking-for-update', () => events.push('checking'));
    updater.on('update-available', (_event, update) => events.push(`available:${update.version}`));
    updater.on('download-progress', (_event, progress) => events.push(`progress:${progress.transferred}`));
    updater.on('update-downloaded', () => events.push('downloaded'));

    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    assert.equal(update.version, '1.1.0');
    const downloadDirectory = path.join(outputDirectory, 'download-success');
    const downloaded = await updater.downloadUpdate(update, { directory: downloadDirectory });
    assert.deepEqual(fs.readFileSync(downloaded.path), assetContent);
    assert.equal(events[0], 'checking');
    assert.ok(events.includes('available:1.1.0'));
    assert.ok(events.some(event => event === `progress:${assetContent.length}`));
    assert.equal(events.at(-1), 'downloaded');
});

test('returns null for the current version and prereleases by default', async () => {
    const updater = createUpdater();
    manifestVersion = '1.0.0';
    assert.equal(await updater.checkForUpdates(`${origin}/manifest.json`), null);
    manifestVersion = '2.0.0-beta.1';
    assert.equal(await updater.checkForUpdates(`${origin}/manifest.json`), null);
    assert.equal((await updater.checkForUpdates(`${origin}/manifest.json`, { allowPrerelease: true })).version, '2.0.0-beta.1');
});

test('prefers an exact platform and architecture match over a universal payload', async () => {
    assetOverrides = {
        arch: 'any', platform: 'any', type: 'application', format: 'tar.zst',
        requiredRuntimeApi: 1, unpackedSize: 1024,
    };
    additionalAssets = [{
        ...assetOverrides, arch: process.arch, platform: process.platform,
        name: 'specific.tar.zst', sha256: assetHash, size: assetContent.length, url: '/asset',
    }];
    const update = await createUpdater().checkForUpdates(`${origin}/manifest.json`);
    assert.equal(update.asset.name, 'specific.tar.zst');
});

test('falls back to a runtime installer when the application requires a newer API', async () => {
    additionalAssets = [{
        arch: process.arch, platform: process.platform, type: 'application', format: 'tar.zst',
        requiredRuntimeApi: 2, unpackedSize: 1024,
        name: 'application.tar.zst', sha256: assetHash, size: assetContent.length, url: '/asset',
    }];
    const update = await createUpdater().checkForUpdates(`${origin}/manifest.json`);
    assert.equal(update.asset.type, undefined);
    assetOverrides = { ...additionalAssets[0] };
    additionalAssets = [];
    await assert.rejects(createUpdater().checkForUpdates(`${origin}/manifest.json`), /No update asset/);
});

test('downloads chunked assets without Content-Length using the signed size and hash', async () => {
    chunkedAsset = true;
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'chunked') });
    assert.deepEqual(fs.readFileSync(downloaded.path), assetContent);
});

test('follows GitHub release redirects only through explicitly allowed origins', async () => {
    const manifestURL = 'https://github.com/example/app/releases/download/v1.1.0/update.json';
    const manifestCDN = 'https://release-assets.githubusercontent.com/manifest';
    const assetURL = 'https://github.com/example/app/releases/download/v1.1.0/update.exe';
    const assetCDN = 'https://release-assets.githubusercontent.com/asset';
    const unsigned = {
        version: '1.1.0',
        assets: [{
            arch: process.arch, platform: process.platform, name: 'update.exe',
            sha256: assetHash, size: assetContent.length, url: assetURL,
        }],
    };
    const signature = sign(null, Buffer.from(serializeUpdateManifestForSignature(unsigned)), privateKey).toString('base64');
    const requests = [];
    const session = {
        async fetch(input, init) {
            const url = String(input);
            requests.push(url);
            assert.equal(init.redirect, 'manual');
            let response;
            if (url === manifestURL || url === assetURL) {
                response = new Response(null, { status: 302, headers: { location: url === manifestURL ? manifestCDN : assetCDN } });
            } else if (url === manifestCDN) {
                response = Response.json({ ...unsigned, signature });
            } else if (url === assetCDN) {
                response = new Response(assetContent);
            } else {
                throw new Error(`Unexpected request: ${url}`);
            }
            Object.defineProperty(response, 'url', { value: url });
            return response;
        },
    };
    await assert.rejects(createUpdater({ session }).checkForUpdates(manifestURL), /redirect origin is not allowed/);
    assert.deepEqual(requests, [manifestURL]);
    requests.length = 0;
    const updater = createUpdater({
        session,
        allowedOrigins: ['https://github.com', 'https://release-assets.githubusercontent.com'],
    });
    const update = await updater.checkForUpdates(manifestURL);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'github-redirect') });
    assert.deepEqual(fs.readFileSync(downloaded.path), assetContent);
    assert.deepEqual(requests, [manifestURL, manifestCDN, assetURL, assetCDN]);
});

test('releases the download lock after failing to create its directory', async () => {
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const directory = path.join(outputDirectory, 'retry-directory');
    fs.writeFileSync(directory, 'not a directory');
    await assert.rejects(updater.downloadUpdate(update, { directory }), { code: 'EEXIST' });
    fs.unlinkSync(directory);
    const downloaded = await updater.downloadUpdate(update, { directory });
    assert.deepEqual(fs.readFileSync(downloaded.path), assetContent);
});

test('rejects copied or mutated downloaded metadata even for a verified artifact path', async () => {
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'provenance') });
    assert.equal(Object.isFrozen(downloaded), true);
    assert.equal(Object.isFrozen(downloaded.asset), true);
    await assert.rejects(updater.install({ ...downloaded }), /not downloaded/);
    await assert.rejects(updater.install({ ...downloaded, version: '999.0.0' }), /not downloaded/);
    await assert.rejects(createUpdater().install(downloaded), /not downloaded/);
    fs.writeFileSync(downloaded.path, Buffer.alloc(assetContent.length));
    await assert.rejects(updater.install(downloaded), /changed after verification/);
});

test('honors cancellation when the verified artifact is already cached', async () => {
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const directory = path.join(outputDirectory, 'cached-cancelled');
    await updater.downloadUpdate(update, { directory });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(updater.downloadUpdate(update, { directory, signal: controller.signal }), { name: 'AbortError' });
    const downloaded = await updater.downloadUpdate(update, { directory });
    assert.deepEqual(fs.readFileSync(downloaded.path), assetContent);
});

test('accepts explicit tar.zst application payload metadata', async () => {
    assetOverrides = {
        format: 'tar.zst',
        requiredRuntimeApi: 1,
        type: 'application',
        unpackedSize: 1024,
    };
    const update = await createUpdater().checkForUpdates(`${origin}/manifest.json`);
    assert.equal(update.asset.format, 'tar.zst');
    assert.equal(update.asset.type, 'application');
    assert.equal(update.asset.requiredRuntimeApi, 1);
});

test('extracts and atomically activates a tar.zst application payload', async () => {
    const packageJSON = Buffer.from(JSON.stringify({ name: 'payload-test', version: manifestVersion, main: 'main.js' }));
    const main = Buffer.from('module.exports = true;');
    servedAsset = await createApplicationPayload([['package.json', packageJSON], ['main.js', main]]);
    manifestHash = createHash('sha256').update(servedAsset).digest('hex');
    assetOverrides = {
        format: 'tar.zst',
        name: 'application.tar.zst',
        requiredRuntimeApi: 1,
        sha256: manifestHash,
        size: servedAsset.length,
        type: 'application',
        unpackedSize: packageJSON.length + main.length,
    };

    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'payload-download') });
    assert.equal(fs.statSync(downloaded.path).size, update.asset.size);
    assert.equal(createHash('sha256').update(fs.readFileSync(downloaded.path)).digest('hex'), update.asset.sha256);
    await updater.install(downloaded);

    const active = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'application', 'active.json'), 'utf8'));
    const payloadDirectory = path.join(outputDirectory, 'application', 'payloads', manifestHash);
    assert.equal(active.sha256, manifestHash);
    assert.equal(active.requiredRuntimeApi, 1);
    assert.equal(active.runtimeHash, undefined);
    assert.equal(fs.readFileSync(path.join(payloadDirectory, 'main.js'), 'utf8'), main.toString());
    const completion = JSON.parse(fs.readFileSync(path.join(payloadDirectory, '.deskgap-payload.json'), 'utf8'));
    assert.equal(completion.version, manifestVersion);
    assert.equal(completion.requiredRuntimeApi, 1);
});

test('rejects traversal aliases in tar.zst application payloads', async () => {
    const content = Buffer.from('outside');
    servedAsset = await createApplicationPayload([['safe/../outside.txt', content]]);
    manifestHash = createHash('sha256').update(servedAsset).digest('hex');
    assetOverrides = {
        format: 'tar.zst',
        name: 'unsafe.tar.zst',
        requiredRuntimeApi: 1,
        sha256: manifestHash,
        size: servedAsset.length,
        type: 'application',
        unpackedSize: content.length,
    };
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'unsafe-download') });
    assert.equal(fs.statSync(downloaded.path).size, update.asset.size);
    assert.equal(createHash('sha256').update(fs.readFileSync(downloaded.path)).digest('hex'), update.asset.sha256);
    await assert.rejects(updater.install(downloaded), /unsafe path/);
    assert.equal(fs.existsSync(path.join(outputDirectory, 'outside.txt')), false);
});

test('does not activate an application payload with a different package version', async () => {
    const activePath = path.join(outputDirectory, 'application', 'active.json');
    const previousActive = JSON.stringify({ sha256: assetHash, version: '1.0.0' });
    fs.mkdirSync(path.dirname(activePath), { recursive: true });
    fs.writeFileSync(activePath, previousActive);
    const packageJSON = Buffer.from(JSON.stringify({ name: 'payload-test', version: '0.9.0' }));
    servedAsset = await createApplicationPayload([['package.json', packageJSON]]);
    manifestHash = createHash('sha256').update(servedAsset).digest('hex');
    assetOverrides = {
        type: 'application', format: 'tar.zst', requiredRuntimeApi: 1,
        name: 'wrong-version.tar.zst', size: servedAsset.length, unpackedSize: packageJSON.length,
    };
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'wrong-version') });
    await assert.rejects(updater.install(downloaded), /version does not match/);
    assert.equal(fs.readFileSync(activePath, 'utf8'), previousActive);
});

test('rejects missing or external application entries before changing activation', async () => {
    const activePath = path.join(outputDirectory, 'application', 'active.json');
    const previousActive = JSON.stringify({ sha256: assetHash, version: '1.0.0' });
    fs.mkdirSync(path.dirname(activePath), { recursive: true });
    fs.writeFileSync(activePath, previousActive);
    const externalEntry = path.join(outputDirectory, 'external-entry.js');
    fs.writeFileSync(externalEntry, 'module.exports = true;');
    for (const main of ['missing.js', externalEntry]) {
        const packageJSON = Buffer.from(JSON.stringify({ name: 'payload-test', version: manifestVersion, main }));
        servedAsset = await createApplicationPayload([['package.json', packageJSON]]);
        manifestHash = createHash('sha256').update(servedAsset).digest('hex');
        assetOverrides = {
            type: 'application', format: 'tar.zst', requiredRuntimeApi: 1,
            name: 'invalid-entry.tar.zst', size: servedAsset.length, unpackedSize: packageJSON.length,
        };
        const updater = createUpdater();
        const update = await updater.checkForUpdates(`${origin}/manifest.json`);
        const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'invalid-entry') });
        await assert.rejects(updater.install(downloaded), /Application payload entry/);
        assert.equal(fs.readFileSync(activePath, 'utf8'), previousActive);
    }
});

test('does not reactivate a cached payload whose entry has disappeared', async () => {
    const main = Buffer.from('module.exports = "cached";');
    const packageJSON = Buffer.from(JSON.stringify({ name: 'payload-test', version: manifestVersion, main: 'main.js' }));
    servedAsset = await createApplicationPayload([['package.json', packageJSON], ['main.js', main]]);
    manifestHash = createHash('sha256').update(servedAsset).digest('hex');
    assetOverrides = {
        type: 'application', format: 'tar.zst', requiredRuntimeApi: 1,
        name: 'cached-entry.tar.zst', size: servedAsset.length, unpackedSize: packageJSON.length + main.length,
    };
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'cached-entry') });
    await updater.install(downloaded);
    const activePath = path.join(outputDirectory, 'application', 'active.json');
    const previousActive = JSON.stringify({ sha256: assetHash, version: '1.0.0' });
    fs.writeFileSync(activePath, previousActive);
    fs.unlinkSync(path.join(outputDirectory, 'application', 'payloads', manifestHash, 'main.js'));
    await assert.rejects(updater.install(downloaded), /Application payload entry/);
    assert.equal(fs.readFileSync(activePath, 'utf8'), previousActive);
});

test('rejects platform-ambiguous paths in tar.zst application payloads', async () => {
    const content = Buffer.from('alternate stream');
    servedAsset = await createApplicationPayload([['safe/file.txt:stream', content]]);
    manifestHash = createHash('sha256').update(servedAsset).digest('hex');
    assetOverrides = {
        format: 'tar.zst',
        name: 'ambiguous.tar.zst',
        requiredRuntimeApi: 1,
        sha256: manifestHash,
        size: servedAsset.length,
        type: 'application',
        unpackedSize: content.length,
    };
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    const downloaded = await updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'ambiguous-download') });
    await assert.rejects(updater.install(downloaded), /unsafe path/);
});

test('rejects incomplete application payload metadata', async () => {
    assetOverrides = { type: 'application' };
    await assert.rejects(
        createUpdater().checkForUpdates(`${origin}/manifest.json`),
        /tar\.zst format, runtime API, and unpacked size/,
    );
});

test('rejects hash mismatches, insecure URLs, and forged install artifacts', async () => {
    const updater = createUpdater();
    manifestHash = '0'.repeat(64);
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    await assert.rejects(
        updater.downloadUpdate(update, { directory: path.join(outputDirectory, 'download-failure') }),
        /SHA-256/,
    );
    await assert.rejects(updater.checkForUpdates('http://updates.example.com/manifest.json'), /HTTPS/);
    await assert.rejects(
        updater.downloadUpdate({ ...update }, { directory: path.join(outputDirectory, 'forged-metadata') }),
        /signature verification/,
    );
    await assert.rejects(updater.install({ ...update, path: path.join(outputDirectory, 'forged.exe') }, { quit: false }), /not downloaded/);
});

test('rejects unsigned trust configuration and tampered manifests', async () => {
    const noKey = new Updater({ allowLoopback: true, session: { fetch: (input, init) => fetch(input, init) } });
    await assert.rejects(noKey.checkForUpdates(`${origin}/manifest.json`), /trusted Ed25519/);
    const noLoopback = new Updater({
        session: { fetch: (input, init) => fetch(input, init) },
        trustedPublicKey: publicKey.export({ format: 'pem', type: 'spki' }),
    });
    await assert.rejects(noLoopback.checkForUpdates(`${origin}/manifest.json`), /HTTPS/);
    invalidSignature = true;
    await assert.rejects(createUpdater().checkForUpdates(`${origin}/manifest.json`), /signature verification/);
});

test('propagates download cancellation and removes partial files', async () => {
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    assetDelay = 1000;
    const controller = new AbortController();
    const directory = path.join(outputDirectory, 'download-cancelled');
    const pending = updater.downloadUpdate(update, { directory, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
    assert.equal(files.some(file => file.endsWith('.part')), false);
});

test('serializes downloads targeting the same artifact path', async () => {
    const updater = createUpdater();
    const update = await updater.checkForUpdates(`${origin}/manifest.json`);
    assetDelay = 100;
    const directory = path.join(outputDirectory, 'download-concurrent');
    const first = updater.downloadUpdate(update, { directory });
    await assert.rejects(updater.downloadUpdate(update, { directory }), /already writing/);
    await first;
});
