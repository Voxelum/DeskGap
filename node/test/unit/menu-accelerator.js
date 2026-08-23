const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-menu-'));
const outputFile = path.join(outputDirectory, 'accelerator.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/accelerator.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { parseAcceleratorToTokens } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('normalizes accelerator aliases and whitespace', () => {
    const commandOrControl = process.platform === 'darwin' ? 'cmd' : 'ctrl';
    assert.deepEqual(parseAcceleratorToTokens(' CommandOrControl + Shift + Return '), [commandOrControl, 'shift', 'enter']);
    assert.deepEqual(parseAcceleratorToTokens('Ctrl++'), ['ctrl', '+']);
    assert.deepEqual(parseAcceleratorToTokens('Ctrl+Plus'), ['ctrl', '+']);
    assert.deepEqual(parseAcceleratorToTokens('F24'), ['f24']);
    assert.deepEqual(parseAcceleratorToTokens(''), []);
});

test('rejects ambiguous accelerators before they reach native menus', () => {
    assert.throws(() => parseAcceleratorToTokens('Ctrl'), /must contain a key/);
    assert.throws(() => parseAcceleratorToTokens('Ctrl+Ctrl+A'), /Duplicate modifier/);
    assert.throws(() => parseAcceleratorToTokens('Ctrl+A+B'), /exactly one key/);
    assert.throws(() => parseAcceleratorToTokens('Ctrl++A'), /Invalid accelerator/);
    assert.throws(() => parseAcceleratorToTokens('Ctrl+NotAKey'), /Invalid key/);
    assert.throws(() => parseAcceleratorToTokens('F25'), /Invalid key/);
});