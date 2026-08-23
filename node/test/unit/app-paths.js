const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-app-paths-'));
const resourcesDirectory = path.join(outputDirectory, 'resources');
const embeddedAppDirectory = path.join(resourcesDirectory, 'app');
fs.mkdirSync(embeddedAppDirectory, { recursive: true });
fs.writeFileSync(path.join(embeddedAppDirectory, 'package.json'), JSON.stringify({
    name: 'stable-package-id',
    productName: 'Built Name',
    version: '1.0.0',
}));

const outputFile = path.join(outputDirectory, 'app.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/app.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const bases = {
    0: path.join(outputDirectory, 'roaming'),
    9: path.join(outputDirectory, 'local'),
    10: path.join(outputDirectory, 'cache'),
};
global.__embedder_mod = {
    appNative: {
        getExecutablePath() { return path.join(outputDirectory, 'DeskGap.exe'); },
        getPath(name) { return bases[name]; },
    },
    commitUISync() {},
    delayUISync() {},
};
process.resourcesPath = resourcesDirectory;
const { app } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('keeps storage paths fixed to the embedded build identity', () => {
    const expected = {
        userData: path.join(bases[0], 'Built Name'),
        localData: path.join(bases[9], 'Built Name'),
        sessionData: path.join(bases[9], 'Built Name', 'Sessions'),
        cache: process.platform === 'win32'
            ? path.join(bases[10], 'Built Name', 'Cache')
            : path.join(bases[10], 'Built Name'),
        logs: path.join(bases[9], 'Built Name', 'Logs'),
    };

    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(name => [name, app.getPath(name)])), expected);
    app.setName('Changed Display Name');
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(name => [name, app.getPath(name)])), expected);
});