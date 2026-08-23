const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-file-handles-'));
const outputFile = path.join(outputDirectory, 'native-file-handles.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/internal/native-file-handles.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { NativeFileHandleRegistry } = require(outputFile);

const droppedDirectory = path.join(outputDirectory, 'directory');
const droppedFile = path.join(outputDirectory, 'file.txt');
fs.mkdirSync(droppedDirectory);
fs.writeFileSync(droppedFile, 'content');

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('issues opaque file and directory capabilities without exposing paths', () => {
    const registry = new NativeFileHandleRegistry();
    const entries = registry.issue([droppedFile, droppedDirectory], 4);
    assert.equal(entries.length, 2);
    assert.match(entries[0].handle, /^dgfile_[A-Za-z0-9_-]{43}$/);
    assert.equal(entries[0].name, 'file.txt');
    assert.equal(entries[0].kind, 'file');
    assert.equal(entries[0].size, 7);
    assert.equal(entries[1].kind, 'directory');
    assert.equal(entries[1].size, null);
    assert.equal(JSON.stringify(entries).includes(outputDirectory), false);
    assert.equal(registry.resolve(entries[0].handle, 4), droppedFile);
});

test('scopes handles to a navigation and revokes them', () => {
    const registry = new NativeFileHandleRegistry();
    const [entry] = registry.issue([droppedFile], 1);
    assert.throws(() => registry.resolve(entry.handle, 2), /invalid/);
    registry.revokeAll();
    assert.throws(() => registry.resolve(entry.handle, 1), /invalid/);
});

test('expires handles and ignores missing or unsupported paths', () => {
    let now = 10;
    const registry = new NativeFileHandleRegistry(50, () => now);
    const [entry] = registry.issue([droppedFile, path.join(outputDirectory, 'missing')], 1);
    assert.ok(entry);
    now = 61;
    assert.throws(() => registry.resolve(entry.handle, 1), /expired/);
});

test('bounds active capabilities across repeated drops', () => {
    const registry = new NativeFileHandleRegistry();
    const [oldest] = registry.issue([droppedFile], 1);
    for (let index = 0; index < 256; index++) registry.issue([droppedFile], 1);
    assert.throws(() => registry.resolve(oldest.handle, 1), /invalid/);
});

test('rejects a path whose filesystem object was replaced', () => {
    const replaceable = path.join(outputDirectory, 'replaceable.txt');
    const original = path.join(outputDirectory, 'original.txt');
    fs.writeFileSync(replaceable, 'first');
    const registry = new NativeFileHandleRegistry();
    const [entry] = registry.issue([replaceable], 1);
    fs.renameSync(replaceable, original);
    fs.writeFileSync(replaceable, 'second');
    assert.throws(() => registry.resolve(entry.handle, 1), /replaced/);
});
