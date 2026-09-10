const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../npm/install.js'), 'utf8');

for (const hasRuntime of [false, true]) {
    test(`npm installer ${hasRuntime ? 'installs an included runtime' : 'clearly rejects an excluded platform'}`, async () => {
        const directory = path.resolve(__dirname, 'fixture-package');
        const metadataPath = path.join(directory, 'dist_files', 'win32-x64.json');
        const calls = [];
        const exit = new Error('process exit');
        const context = {
            __dirname: directory,
            console: { error: message => calls.push(['error', message]) },
            process: {
                platform: 'win32',
                arch: 'x64',
                on() {},
                exit(code) { calls.push(['exit', code]); throw exit; },
            },
            require(id) {
                if (id === 'path') return path;
                if (id === 'fs') return {
                    existsSync(file) { assert.equal(file, metadataPath); return hasRuntime; },
                    unlinkSync() {},
                };
                if (id === './util') return {
                    downloadFile: async filename => calls.push(['download', filename]),
                    sha256OfPath: async () => 'expected-hash',
                };
                if (id === 'fs-extra') return { remove: async () => {} };
                if (id === 'decompress') return async () => { calls.push(['extract']); };
                assert.equal(id, metadataPath);
                return { filename: 'runtime.zip', sha256: 'expected-hash' };
            },
        };
        if (hasRuntime) {
            vm.runInNewContext(source, context);
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(calls, [['download', 'runtime.zip'], ['extract']]);
        }
        else {
            assert.throws(() => vm.runInNewContext(source, context), error => error === exit);
            assert.deepEqual(calls, [
                ['error', 'This DeskGap package does not include a runtime for win32-x64.'],
                ['exit', 1],
            ]);
        }
    });
}
