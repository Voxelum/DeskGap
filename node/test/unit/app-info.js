const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const directory = fs.mkdtempSync(path.join(__dirname, '.app-info-'));
const resources = path.join(directory, 'resources');
const embeddedApp = path.join(resources, 'app');
const developmentApp = path.join(directory, 'development');
const output = path.join(directory, 'info.cjs');
const originalResources = process.resourcesPath;
const originalEntry = process.env.DESKGAP_ENTRY;
const originalNative = global.__embedder_mod;
const defaultAppFlag = path.join(embeddedApp, 'DESKGAP_DEFAULT_APP');

fs.mkdirSync(embeddedApp, { recursive: true });
fs.mkdirSync(developmentApp);
fs.writeFileSync(path.join(embeddedApp, 'package.json'), JSON.stringify({
    name: 'embedded-id', productName: 'Embedded Name', version: '1.0.0',
}));
buildSync({
    bundle: true,
    stdin: {
        contents: `
            export { default as info } from './app-info';
            export { embeddedAppIdentity } from './app-identity';
            export { getApplicationPayloadRoot } from './application-payload';
        `,
        resolveDir: path.resolve(__dirname, '../../js/node/internal'),
        loader: 'ts',
    },
    outfile: output,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
});

function load(packageJSON, defaultApp = true) {
    fs.writeFileSync(path.join(developmentApp, 'package.json'), JSON.stringify(packageJSON));
    if (defaultApp) fs.writeFileSync(defaultAppFlag, '');
    else fs.rmSync(defaultAppFlag, { force: true });
    process.resourcesPath = resources;
    process.env.DESKGAP_ENTRY = developmentApp;
    global.__embedder_mod = { appNative: { getPath: () => path.join(directory, 'local') } };
    delete require.cache[output];
    delete require.cache[path.join(developmentApp, 'package.json')];
    return require(output);
}

test.after(() => {
    if (originalResources === undefined) delete process.resourcesPath;
    else process.resourcesPath = originalResources;
    if (originalEntry === undefined) delete process.env.DESKGAP_ENTRY;
    else process.env.DESKGAP_ENTRY = originalEntry;
    if (originalNative === undefined) delete global.__embedder_mod;
    else global.__embedder_mod = originalNative;
    delete require.cache[output];
    fs.rmSync(directory, { recursive: true, force: true });
});

test('development entry metadata uses its own name, productName and version', () => {
    const { info, embeddedAppIdentity, getApplicationPayloadRoot } = load({
        name: 'development-id', productName: 'Development Name', version: '2.0.0',
    });
    assert.deepEqual(info, { id: 'development-id', name: 'Development Name', version: '2.0.0' });
    assert.equal(Object.isFrozen(embeddedAppIdentity), true);
    assert.equal(embeddedAppIdentity.id, 'embedded-id');
    assert.equal(embeddedAppIdentity.storageName, 'Embedded Name');
    assert.equal(getApplicationPayloadRoot(), process.platform === 'win32'
        ? path.join(directory, 'local', 'Programs', 'Embedded Name', 'application')
        : path.join(directory, 'local', 'Embedded Name', 'application'));
});

test('development entry falls back to package name when productName is absent', () => {
    assert.deepEqual(load({ name: 'development-id', version: '2.0.0' }).info, {
        id: 'development-id', name: 'development-id', version: '2.0.0',
    });
});

test('packaged applications ignore environment entry metadata', () => {
    assert.deepEqual(load({ name: 'other-id', productName: 'Other Name', version: '2.0.0' }, false).info, {
        id: 'embedded-id', name: 'Embedded Name', version: '1.0.0',
    });
});

test('active update metadata cannot replace the embedded application identity', () => {
    const { getApplicationPayloadRoot } = load({}, false);
    const root = getApplicationPayloadRoot();
    const hash = 'a'.repeat(64);
    const payload = path.join(root, 'payloads', hash);
    const marker = { sha256: hash, version: '3.0.0', requiredRuntimeApi: 1 };
    fs.mkdirSync(payload, { recursive: true });
    fs.writeFileSync(path.join(root, 'active.json'), JSON.stringify(marker));
    fs.writeFileSync(path.join(payload, '.deskgap-payload.json'), JSON.stringify(marker));
    fs.writeFileSync(path.join(payload, 'package.json'), JSON.stringify({
        name: 'updated-id', productName: 'Updated Name', version: '3.0.0', main: 'index.js',
    }));
    fs.writeFileSync(path.join(payload, 'index.js'), '');
    assert.deepEqual(load({}, false).info, {
        id: 'embedded-id', name: 'Embedded Name', version: '3.0.0',
    });
});
