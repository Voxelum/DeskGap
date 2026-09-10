const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zstdDecompressSync } = require('node:zlib');
const { extract } = require('tar-stream');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-application-package-'));
const source = path.join(root, 'application');
const runtime = path.join(root, 'runtime');
const bootstrap = path.join(root, 'bootstrap.exe');
const sourcePackage = JSON.stringify({ name: 'package-test', main: 'main.js', version: '0.1.0' });
const version = '1.2.3-beta.1';

test.before(() => {
    fs.mkdirSync(source);
    fs.mkdirSync(runtime);
    fs.writeFileSync(path.join(source, 'package.json'), sourcePackage);
    fs.writeFileSync(path.join(source, 'main.js'), 'module.exports = true;');
    fs.writeFileSync(path.join(runtime, 'DeskGap.exe'), 'runtime');
    fs.writeFileSync(bootstrap, 'bootstrap');
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function runScript(script, args) {
    return spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts', script), ...args], { encoding: 'utf8' });
}

async function unpack(archive) {
    const entries = new Map();
    const tar = extract();
    const completed = new Promise((resolve, reject) => {
        tar.on('entry', (header, stream, next) => {
            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => { entries.set(header.name, Buffer.concat(chunks)); next(); });
            stream.on('error', reject);
        });
        tar.on('finish', resolve);
        tar.on('error', reject);
    });
    tar.end(zstdDecompressSync(archive));
    await completed;
    return entries;
}

test('packages the release version without modifying the application source', async () => {
    const output = path.join(root, 'application.tar.zst');
    const result = runScript('package-application.mjs', [source, output, version]);
    assert.equal(result.status, 0, result.stderr);
    const archive = fs.readFileSync(output);
    const entries = await unpack(archive);
    const metadata = JSON.parse(fs.readFileSync(`${output}.metadata.json`, 'utf8'));
    assert.equal(JSON.parse(entries.get('package.json')).version, version);
    assert.equal(metadata.version, version);
    assert.equal(metadata.asset.size, archive.length);
    assert.equal(metadata.asset.unpackedSize, [...entries.values()].reduce((size, entry) => size + entry.length, 0));
    assert.equal(metadata.asset.sha256, createHash('sha256').update(archive).digest('hex'));
    assert.equal(fs.readFileSync(path.join(source, 'package.json'), 'utf8'), sourcePackage);
    const repeated = path.join(root, 'repeated.tar.zst');
    assert.equal(runScript('package-application.mjs', [source, repeated, version]).status, 0);
    assert.deepEqual(fs.readFileSync(repeated), archive);
});

test('uses the same versioned application payload in a click-to-run executable', async () => {
    const output = path.join(root, 'application.exe');
    const result = runScript('package-click-to-run.mjs', [bootstrap, runtime, source, output, version]);
    assert.equal(result.status, 0, result.stderr);
    const executable = fs.readFileSync(output);
    const footer = executable.subarray(-108);
    const runtimeSize = Number(footer.readBigUInt64LE(28));
    const applicationSize = Number(footer.readBigUInt64LE(36));
    const offset = fs.statSync(bootstrap).size + runtimeSize;
    const entries = await unpack(executable.subarray(offset, offset + applicationSize));
    assert.equal(JSON.parse(entries.get('package.json')).version, version);
    const runtimeEntries = await unpack(executable.subarray(fs.statSync(bootstrap).size, offset));
    assert.equal(JSON.parse(runtimeEntries.get('resources/app-identity.json')).version, version);
    assert.equal(fs.readFileSync(path.join(source, 'package.json'), 'utf8'), sourcePackage);
});

test('rejects release versions that the updater cannot compare', () => {
    const payload = path.join(root, 'invalid.tar.zst');
    const executable = path.join(root, 'invalid.exe');
    for (const result of [
        runScript('package-application.mjs', [source, payload, 'next']),
        runScript('package-click-to-run.mjs', [bootstrap, runtime, source, executable, 'next']),
    ]) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /valid semver/);
    }
    assert.equal(fs.existsSync(payload), false);
    assert.equal(fs.existsSync(executable), false);
});
