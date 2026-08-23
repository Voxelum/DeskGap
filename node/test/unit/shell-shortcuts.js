const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-shell-shortcuts-'));
const outputFile = path.join(outputDirectory, 'shell.cjs');
buildSync({
    bundle: true,
    define: { 'process.platform': '"win32"' },
    entryPoints: [path.resolve(__dirname, '../../js/node/shell.ts')],
    external: ['./app'],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const calls = [];
const desktop = path.join(outputDirectory, 'Desktop');
const appData = path.join(outputDirectory, 'AppData');
const executable = path.join(outputDirectory, 'DeskGap.exe');
fs.writeFileSync(path.join(outputDirectory, 'app.js'), `exports.app = { getPath(name) { return ({ appData: ${JSON.stringify(appData)}, desktop: ${JSON.stringify(desktop)}, exe: ${JSON.stringify(executable)} })[name] } };`);
global.__embedder_mod = {
    shellNative: {
        writeShortcutLink(...args) { calls.push(args); return true; },
    },
};
const { shell } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => calls.length = 0);

test('creates an idempotent desktop shortcut with executable defaults', () => {
    assert.equal(shell.createDesktopShortcut('XMCL', { args: '--global', description: 'Launcher' }), true);
    assert.deepEqual(calls, [[
        path.join(desktop, 'XMCL.lnk'),
        'replace',
        {
            args: '--global',
            description: 'Launcher',
            target: executable,
            cwd: outputDirectory,
            icon: null,
            iconIndex: 0,
            appUserModelId: null,
            toastActivatorClsid: null,
        },
    ]]);
});

test('creates a Start Menu shortcut and preserves explicit target details', () => {
    const target = path.join(outputDirectory, 'bin', 'launcher.exe');
    assert.equal(shell.createStartMenuShortcut('XMCL.lnk', { target, cwd: outputDirectory, icon: target }), true);
    assert.equal(calls[0][0], path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'XMCL.lnk'));
    assert.equal(calls[0][2].target, target);
    assert.equal(calls[0][2].cwd, outputDirectory);
});

test('rejects shortcut names that can escape the destination directory', () => {
    for (const name of ['', '.', '..', '../XMCL', 'folder/XMCL', 'bad:name', 'trailing.', 'trailing ', 'CON', 'LPT1.lnk']) {
        assert.throws(() => shell.createDesktopShortcut(name), /Shortcut name/);
    }
    assert.deepEqual(calls, []);
});