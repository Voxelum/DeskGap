const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { build } = require('esbuild');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-windows-executable-'));
const executable = path.join(root, 'update.exe');
const localData = path.join(root, 'local');
const publishers = ['CN=Example Publisher, O=Example Publisher, C=US'];
const content = Buffer.from('mock signed executable');
const sha256 = createHash('sha256').update(content).digest('hex');
const state = { localData, verified: [], spawned: [], exited: [], unref: 0 };
global.__windowsExecutableTestState = state;

async function loadModule(platform, hasNative = true) {
    const output = path.join(root, `${platform}-${hasNative}.cjs`);
    await build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '../../js/node/windows-executable.ts')],
        format: 'cjs',
        outfile: output,
        platform: 'node',
        target: 'node24',
        define: { 'process.platform': JSON.stringify(platform) },
        plugins: [{
            name: 'mock-executable-host',
            setup(build) {
                build.onResolve({ filter: /^(\.\/app|\.\/internal\/native|child_process)$/ }, args => {
                    if (!args.importer.endsWith('windows-executable.ts')) return null;
                    return { path: args.path, namespace: 'mock' };
                });
                build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
                    const shared = 'const state = global.__windowsExecutableTestState;';
                    if (args.path === './app') return { contents: shared + `
                        export const app = { getPath() { return state.localData }, exit(code) { state.exited.push(code) } };
                    ` };
                    if (args.path === './internal/native') return { contents: shared + `
                        export const windowsExecutableNative = ${hasNative ? `{
                            async verifySignature(file, names) {
                                state.verified.push({ file, names });
                                if (state.signatureError) throw state.signatureError;
                            }
                        }` : 'undefined'};
                    ` };
                    return { contents: shared + `
                        import { EventEmitter } from 'node:events';
                        export function spawn(file, args, options) {
                            state.spawned.push({ file, args, options });
                            if (state.spawnThrows) throw state.spawnThrows;
                            const child = new EventEmitter();
                            child.unref = () => state.unref++;
                            process.nextTick(() => state.spawnError
                                ? child.emit('error', state.spawnError) : child.emit('spawn'));
                            return child;
                        }
                    ` };
                });
            },
        }],
    });
    return require(output).windowsExecutable;
}

let api;
let unsupported;
let missingNative;

test.before(async () => {
    api = await loadModule('win32');
    unsupported = await loadModule('linux');
    missingNative = await loadModule('win32', false);
});
test.beforeEach(() => {
    fs.writeFileSync(executable, content);
    fs.rmSync(localData, { recursive: true, force: true });
    state.verified.length = state.spawned.length = state.exited.length = 0;
    state.unref = 0;
    state.signatureError = state.spawnError = state.spawnThrows = null;
});
test.after(() => {
    delete global.__windowsExecutableTestState;
    fs.rmSync(root, { recursive: true, force: true });
});

test('requires Windows and a native signature verifier', async () => {
    assert.equal(api.isSupported(), true);
    for (const candidate of [unsupported, missingNative]) {
        assert.equal(candidate.isSupported(), false);
        await assert.rejects(candidate.verifySignature(executable, publishers), { code: 'ERR_WINDOWS_EXECUTABLE_UNSUPPORTED' });
        await assert.rejects(candidate.install(executable, { publisherNames: publishers }), { code: 'ERR_WINDOWS_EXECUTABLE_UNSUPPORTED' });
    }
    assert.equal(state.verified.length, 0);
});

test('validates explicit publishers, executable files, and installer arguments', async () => {
    for (const invalid of [[], [''], ['\0'], [12], undefined]) {
        await assert.rejects(api.verifySignature(executable, invalid), /publisherNames/);
    }
    await assert.rejects(api.verifySignature('update.bat', publishers), /EXE/);
    await assert.rejects(api.verifySignature('update\0.exe', publishers), /EXE/);
    await assert.rejects(api.verifySignature(path.join(root, 'missing.exe'), publishers), { code: 'ENOENT' });
    const directory = path.join(root, 'directory.exe');
    fs.mkdirSync(directory);
    await assert.rejects(api.verifySignature(directory, publishers), /regular file/);
    await assert.rejects(api.install(executable, { publisherNames: publishers, sha256: 'bad' }), /SHA-256/);
    await assert.rejects(api.install(executable, { publisherNames: publishers, args: ['bad\0arg'] }), /arguments/);
    assert.equal(state.verified.length, 0);
    assert.equal(state.spawned.length, 0);
});

test('does not hide signature or publisher validation errors', async () => {
    state.signatureError = new Error('Untrusted publisher');
    await assert.rejects(api.verifySignature(executable, publishers), error => error === state.signatureError);
    await assert.rejects(api.install(executable, { publisherNames: publishers }), error => error === state.signatureError);
    assert.equal(state.spawned.length, 0);
    assert.deepEqual(state.exited, []);
    assert.deepEqual(fs.readdirSync(path.join(localData, 'updates')), []);
});

test('rechecks the staged signed bytes and passes literal arguments without a shell', async () => {
    await api.verifySignature(executable, publishers);
    const mutableNames = [...publishers];
    const mutableArgs = ['--deskgap-wait-for-pid=12345', '& not-a-shell-command'];
    const pending = api.install(executable, { publisherNames: mutableNames, args: mutableArgs, sha256 });
    mutableNames[0] = 'CN=Untrusted';
    mutableArgs[0] = '--changed';
    await pending;
    assert.equal(state.verified.length, 2);
    const staged = state.verified[1];
    assert.notEqual(staged.file, executable);
    assert.deepEqual(staged.names, publishers);
    assert.deepEqual(fs.readFileSync(staged.file), content);
    assert.deepEqual(state.spawned, [{
        file: staged.file,
        args: ['--deskgap-wait-for-pid=12345', '& not-a-shell-command'],
        options: { cwd: path.dirname(staged.file), detached: true, stdio: 'ignore', windowsHide: true },
    }]);
    assert.equal(state.unref, 1);
    assert.deepEqual(state.exited, []);
});

test('rejects changed downloaded bytes before signature verification or execution', async () => {
    await api.verifySignature(executable, publishers);
    fs.appendFileSync(executable, 'tampered');
    await assert.rejects(api.install(executable, { publisherNames: publishers, sha256, quit: true }), /changed after download/);
    assert.equal(state.verified.length, 1);
    assert.equal(state.spawned.length, 0);
    assert.deepEqual(state.exited, []);
    assert.deepEqual(fs.readdirSync(path.join(localData, 'updates')), []);
});

test('cleans staged failures and never quits when process creation fails', async () => {
    for (const field of ['spawnThrows', 'spawnError']) {
        state[field] = new Error('Process creation failed');
        await assert.rejects(api.install(executable, { publisherNames: publishers, quit: true }), error => error === state[field]);
        state[field] = null;
        assert.deepEqual(state.exited, []);
        assert.equal(state.unref, 0);
        assert.deepEqual(fs.readdirSync(path.join(localData, 'updates')), []);
    }
});

test('quits only after successful process creation when explicitly requested', async () => {
    const pending = api.install(executable, { publisherNames: publishers, quit: true });
    assert.deepEqual(state.exited, []);
    await pending;
    assert.equal(state.unref, 1);
    assert.deepEqual(state.exited, [0]);
});
