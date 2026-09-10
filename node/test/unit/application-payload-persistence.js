const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { build } = require('esbuild');

const directory = path.join(__dirname, `.application-payload-${randomUUID()}`);
const output = path.join(directory, 'resolver.cjs');
const programRoot = path.join(directory, 'data', 'Programs', 'Persistence Test');
const applicationRoot = path.join(programRoot, 'application');
const originalResourcesPath = process.resourcesPath;
const originalEntry = process.env.DESKGAP_ENTRY;
let sequence = 0;

function hash() {
    return (++sequence).toString(16).padStart(64, '0');
}

function json(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

function payload(version, requiredRuntimeApi) {
    const sha256 = hash();
    const marker = { sha256, version, ...(requiredRuntimeApi === undefined ? {} : { requiredRuntimeApi }) };
    const directory = path.join(applicationRoot, 'payloads', sha256);
    json(path.join(directory, 'package.json'), { name: 'persistence-test', version, main: 'main.js' });
    json(path.join(directory, '.deskgap-payload.json'), marker);
    fs.writeFileSync(path.join(directory, 'main.js'), '// fixture');
    return { marker, directory };
}

function bundle(version, runtimeHash = hash()) {
    const app = payload(version);
    json(path.join(applicationRoot, 'bundles', `${runtimeHash}.json`), app.marker);
    return { ...app, runtimeHash };
}

function loadRuntime(runtimeHash, version = '1.0.0', defaultApp = false) {
    process.resourcesPath = path.join(programRoot, 'runtime', runtimeHash, 'resources');
    json(path.join(process.resourcesPath, 'app-identity.json'), {
        name: 'persistence-test', productName: 'Persistence Test', version,
    });
    if (defaultApp) {
        json(path.join(process.resourcesPath, 'app', 'package.json'), { version });
        fs.writeFileSync(path.join(process.resourcesPath, 'app', 'DESKGAP_DEFAULT_APP'), '');
    }
    delete require.cache[output];
    return require(output).resolveAppPath;
}

function activate(app) {
    json(path.join(applicationRoot, 'active.json'), app.marker);
}

function active() {
    return JSON.parse(fs.readFileSync(path.join(applicationRoot, 'active.json'), 'utf8'));
}

test.before(async () => {
    await build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '../../js/node/internal/application-payload.ts')],
        outfile: output,
        format: 'cjs',
        platform: 'node',
        target: 'node24',
        define: { 'process.platform': '"win32"' },
        plugins: [{
            name: 'mock-payload-native',
            setup(build) {
                build.onResolve({ filter: /^\.\/native$/ }, () => ({ path: 'native', namespace: 'mock' }));
                build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
                    contents: `export const appNative = { getPath() { return ${JSON.stringify(path.join(directory, 'data'))} } };`,
                    loader: 'js',
                }));
            },
        }],
    });
});

test.beforeEach(() => {
    fs.rmSync(programRoot, { force: true, recursive: true });
    delete process.env.DESKGAP_ENTRY;
});

test.after(() => {
    if (originalResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = originalResourcesPath;
    if (originalEntry === undefined) delete process.env.DESKGAP_ENTRY;
    else process.env.DESKGAP_ENTRY = originalEntry;
    delete require.cache[output];
    fs.rmSync(directory, { force: true, recursive: true });
});

test('reopening the original click-to-run bundle preserves an activated application update', () => {
    const original = bundle('1.0.0');
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    assert.equal(active().sha256, original.marker.sha256);

    const update = payload('1.1.0', 1);
    activate(update);
    // Native bootstrap republishes its own fallback, never active.json.
    json(path.join(applicationRoot, 'bundles', `${original.runtimeHash}.json`), original.marker);
    assert.equal(loadRuntime(original.runtimeHash)(), update.directory);
    assert.deepEqual(active(), update.marker);
    assert.equal(loadRuntime(original.runtimeHash)(), update.directory);
});

test('a newer full bundle replaces an older activation and persists the selected application', () => {
    const original = bundle('1.0.0');
    const update = payload('1.1.0', 1);
    activate(update);
    const newer = bundle('2.0.0');
    assert.equal(loadRuntime(newer.runtimeHash, '2.0.0')(), newer.directory);
    assert.equal(active().sha256, newer.marker.sha256);
    assert.equal(active().requiredRuntimeApi, 1);
    assert.equal(active().runtimeHash, newer.runtimeHash);
    // Native reopening routes to the new runtime. Bypassing the launcher must not run a full
    // package on an older runtime, even when both advertise the same application-update API.
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    assert.equal(active().runtimeHash, newer.runtimeHash);
    assert.equal(loadRuntime(newer.runtimeHash, '2.0.0')(), newer.directory);
});

test('a full bundle does not replace a still newer compatible app-only update', () => {
    const newer = bundle('2.0.0');
    const update = payload('2.1.0', 1);
    activate(update);
    assert.equal(loadRuntime(newer.runtimeHash, '2.0.0')(), update.directory);
    assert.deepEqual(active(), update.marker);
});

const corruptions = {
    'invalid JSON': () => fs.writeFileSync(path.join(applicationRoot, 'active.json'), '{'),
    'null marker': () => json(path.join(applicationRoot, 'active.json'), null),
    'array marker': () => json(path.join(applicationRoot, 'active.json'), []),
    'array digest': app => activate({ marker: { ...app.marker, sha256: [app.marker.sha256] } }),
    'unsafe digest': app => activate({ marker: { ...app.marker, sha256: '../outside' } }),
    'invalid version': app => activate({ marker: { ...app.marker, version: 'newest' } }),
    'numeric version': app => activate({ marker: { ...app.marker, version: 2 } }),
    'missing completion': app => fs.unlinkSync(path.join(app.directory, '.deskgap-payload.json')),
    'null completion': app => json(path.join(app.directory, '.deskgap-payload.json'), null),
    'wrong completion digest': app => json(path.join(app.directory, '.deskgap-payload.json'), { ...app.marker, sha256: hash() }),
    'wrong completion version': app => json(path.join(app.directory, '.deskgap-payload.json'), { ...app.marker, version: '9.0.0' }),
    'wrong package version': app => json(path.join(app.directory, 'package.json'), { version: '9.0.0' }),
    'null package': app => json(path.join(app.directory, 'package.json'), null),
    'missing package': app => fs.unlinkSync(path.join(app.directory, 'package.json')),
    'missing entry': app => fs.unlinkSync(path.join(app.directory, 'main.js')),
    'entry outside payload': app => {
        fs.writeFileSync(path.join(applicationRoot, 'outside.js'), '// outside');
        json(path.join(app.directory, 'package.json'), { version: app.marker.version, main: '../../outside.js' });
    },
    'null runtime API': app => activate({ marker: { ...app.marker, requiredRuntimeApi: null } }),
    'string runtime API': app => activate({ marker: { ...app.marker, requiredRuntimeApi: '1' } }),
    'fractional runtime API': app => activate({ marker: { ...app.marker, requiredRuntimeApi: 1.5 } }),
    'null runtime hash': app => activate({ marker: { ...app.marker, runtimeHash: null } }),
    'unsafe runtime hash': app => activate({ marker: { ...app.marker, runtimeHash: '../runtime' } }),
    'missing runtime binding': app => activate({ marker: { ...app.marker, runtimeHash: hash() } }),
    'mismatched runtime APIs': app => json(path.join(app.directory, '.deskgap-payload.json'), { ...app.marker, requiredRuntimeApi: 2 }),
};

for (const [name, corrupt] of Object.entries(corruptions)) {
    test(`recovers a ${name} to the complete bundled payload`, () => {
        const original = bundle('1.0.0');
        const update = payload('2.0.0', 1);
        activate(update);
        corrupt(update);
        assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
        assert.equal(active().sha256, original.marker.sha256);
        assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    });
}

test('an incomplete bundled candidate cannot replace a working active payload', () => {
    const newer = bundle('3.0.0');
    fs.unlinkSync(path.join(newer.directory, '.deskgap-payload.json'));
    const update = payload('2.0.0', 1);
    activate(update);
    assert.equal(loadRuntime(newer.runtimeHash, '3.0.0')(), update.directory);
    assert.deepEqual(active(), update.marker);
});

test('a direct old-runtime launch neither runs nor overwrites an incompatible newer activation', () => {
    const original = bundle('1.0.0');
    const incompatible = payload('2.0.0', 2);
    activate(incompatible);
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    assert.deepEqual(active(), incompatible.marker);
});

test('completion-only runtime requirements are enforced for legacy active markers', () => {
    const original = bundle('1.0.0');
    const incompatible = payload('2.0.0', 2);
    activate({ marker: { sha256: incompatible.marker.sha256, version: '2.0.0' } });
    const before = active();
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    assert.deepEqual(active(), before);
});

test('an activation bound to a different full package is invalid rather than a compatible app-only update', () => {
    const original = bundle('1.0.0');
    const update = payload('2.0.0', 1);
    activate({ marker: { ...update.marker, runtimeHash: original.runtimeHash } });
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
    assert.equal(active().sha256, original.marker.sha256);
});

for (const [bundledVersion, activeVersion, winner] of [
    ['1.0.0-beta.2', '1.0.0-beta.10', 'active'],
    ['1.0.0', '1.0.0-rc.1', 'bundle'],
    ['1.0.0-beta.1', '1.0.0', 'active'],
    ['1.0.0-beta', '1.0.0-10', 'bundle'],
    ['1.0.0+new', '1.0.0+old', 'active'],
    ['1.10.0', '1.9.0', 'bundle'],
]) {
    test(`uses semver precedence for ${bundledVersion} versus ${activeVersion}`, () => {
        const original = bundle(bundledVersion);
        const update = payload(activeVersion, 1);
        activate(update);
        const expected = winner === 'active' ? update : original;
        assert.equal(loadRuntime(original.runtimeHash, bundledVersion)(), expected.directory);
        assert.equal(active().sha256, expected.marker.sha256);
    });
}

test('rejects an invalid prerelease version instead of treating it as newer', () => {
    const original = bundle('1.0.0');
    activate(payload('2.0.0-beta.01', 1));
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
});

test('preserves the default development app DESKGAP_ENTRY override without touching activation', () => {
    const original = bundle('1.0.0');
    const update = payload('2.0.0', 1);
    activate(update);
    process.env.DESKGAP_ENTRY = path.join(directory, 'development-app');
    assert.equal(loadRuntime(original.runtimeHash, '1.0.0', true)(), process.env.DESKGAP_ENTRY);
    assert.deepEqual(active(), update.marker);
});

test('does not allow DESKGAP_ENTRY to override a packaged application', () => {
    const original = bundle('1.0.0');
    process.env.DESKGAP_ENTRY = path.join(directory, 'development-app');
    assert.equal(loadRuntime(original.runtimeHash)(), original.directory);
});

test('a traditional runtime still falls back to resources/app when activation is unavailable', () => {
    const resolve = loadRuntime('not-a-click-runtime', '1.0.0', true);
    assert.equal(resolve(), path.join(process.resourcesPath, 'app'));
});
