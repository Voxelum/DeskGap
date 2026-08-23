const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-credentials-'));
const outputFile = path.join(outputDirectory, 'credentials.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/credentials.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const calls = [];
global.__embedder_mod = {
    credentialsNative: {
        async getPassword(...args) { calls.push(['get', ...args]); return 'secret'; },
        async setPassword(...args) { calls.push(['set', ...args]); },
        async deletePassword(...args) { calls.push(['delete', ...args]); return true; },
        async findCredentials(...args) { calls.push(['find', ...args]); return [{ account: 'user', password: 'secret' }]; },
    },
};
const { configureCredentialScope, credentials } = require(outputFile);
configureCredentialScope('test.application');
const scopedService = `deskgap:${createHash('sha256').update('test.application').digest('hex').substring(0, 32)}:service`;

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => calls.length = 0);

test('forwards asynchronous service/account credential operations', async () => {
    assert.equal(await credentials.getPassword('service', 'user'), 'secret');
    await credentials.setPassword('service', 'user', 'new-secret');
    assert.equal(await credentials.deletePassword('service', 'user'), true);
    assert.deepEqual(await credentials.findCredentials('service'), [{ account: 'user', password: 'secret' }]);
    assert.deepEqual(calls, [
        ['get', scopedService, 'user'],
        ['set', scopedService, 'user', 'new-secret'],
        ['delete', scopedService, 'user'],
        ['find', scopedService],
    ]);
});

test('rejects invalid credential identifiers before native calls', async () => {
    await assert.rejects(credentials.getPassword('', 'user'), /service/);
    await assert.rejects(credentials.setPassword('service', '', 'secret'), /account/);
    await assert.rejects(credentials.setPassword('service', 'user', null), /password/);
    assert.deepEqual(calls, []);
});
