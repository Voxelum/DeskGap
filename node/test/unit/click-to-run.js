const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-click-package-'));
const runtime = path.join(root, 'runtime');
const application = path.join(root, 'application');
const bootstrap = path.join(root, 'bootstrap.exe');
const output = path.join(root, 'click.exe');

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

test.after(() => fs.rmSync(root, { force: true, recursive: true }));

test('packages two verified Zstd payloads behind a bootstrap', () => {
    fs.mkdirSync(path.join(runtime, 'resources'), { recursive: true });
    fs.mkdirSync(application, { recursive: true });
    fs.writeFileSync(bootstrap, 'bootstrap');
    fs.writeFileSync(path.join(runtime, 'DeskGap.exe'), 'runtime');
    fs.writeFileSync(path.join(runtime, 'resources', 'fallback.txt'), 'fallback');
    fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify({
        name: 'click-test',
        productName: 'Click Test',
        version: '1.2.3',
    }));
    fs.writeFileSync(path.join(application, 'main.js'), 'application');
    const script = path.resolve(__dirname, '../../scripts/package-click-to-run.mjs');
    const result = spawnSync(process.execPath, [script, bootstrap, runtime, application, output, '1.2.3'], {
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const executable = fs.readFileSync(output);
    const footer = executable.subarray(executable.length - 108);
    assert.equal(footer.toString('ascii', 0, 8), 'DGCLK001');
    assert.equal(footer.readUInt32LE(8), 1);
    const nameSize = footer.readUInt32LE(12);
    const entrySize = footer.readUInt32LE(16);
    const versionSize = footer.readUInt32LE(20);
    const manifestSize = footer.readUInt32LE(24);
    const runtimeSize = Number(footer.readBigUInt64LE(28));
    const applicationSize = Number(footer.readBigUInt64LE(36));
    const stubSize = executable.length - 108 - nameSize - entrySize - versionSize - manifestSize - runtimeSize - applicationSize;
    const runtimeArchive = executable.subarray(stubSize, stubSize + runtimeSize);
    const applicationArchive = executable.subarray(stubSize + runtimeSize, stubSize + runtimeSize + applicationSize);
    let metadataOffset = stubSize + runtimeSize + applicationSize;

    assert.equal(executable.subarray(0, stubSize).toString(), 'bootstrap');
    assert.equal(sha256(runtimeArchive), footer.subarray(44, 76).toString('hex'));
    assert.equal(sha256(applicationArchive), footer.subarray(76, 108).toString('hex'));
    assert.equal(executable.subarray(metadataOffset, metadataOffset += nameSize).toString(), 'Click Test');
    assert.equal(executable.subarray(metadataOffset, metadataOffset += entrySize).toString(), 'DeskGap.exe');
    assert.equal(executable.subarray(metadataOffset, metadataOffset += versionSize).toString(), '1.2.3');
    const manifest = executable.subarray(metadataOffset, metadataOffset + manifestSize).toString();
    assert.match(manifest, /^R\t[a-f0-9]{64}\t7\tDeskGap\.exe$/m);
    assert.match(manifest, /^R\t[a-f0-9]{64}\t\d+\tresources\/app-identity\.json$/m);
    assert.match(manifest, /^A\t[a-f0-9]{64}\t11\tmain\.js$/m);
});

test('rejects previously signed bootstraps before generating or replacing an EXE', () => {
    const script = path.resolve(__dirname, '../../scripts/package-click-to-run.mjs');
    for (const [magic, directories, optionalSize] of [[0x20b, 112, 240], [0x10b, 96, 224]]) {
        const peOffset = 64;
        const optionalOffset = peOffset + 24;
        const pe = Buffer.alloc(optionalOffset + optionalSize);
        pe.write('MZ', 0, 'ascii');
        pe.writeUInt32LE(peOffset, 0x3c);
        pe.writeUInt32LE(0x4550, peOffset);
        pe.writeUInt16LE(optionalSize, peOffset + 20);
        pe.writeUInt16LE(magic, optionalOffset);
        pe.writeUInt32LE(16, optionalOffset + directories - 4);
        // The signing directory alone is sufficient to reject signing-before-assembly.
        pe.writeUInt32LE(512, optionalOffset + directories + 4 * 8);
        pe.writeUInt32LE(256, optionalOffset + directories + 4 * 8 + 4);
        fs.writeFileSync(bootstrap, pe);
        fs.writeFileSync(output, 'existing output');
        const result = spawnSync(process.execPath, [script, bootstrap, runtime, application, output, '1.2.3'], {
            encoding: 'utf8',
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Bootstrap must be unsigned/);
        assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
    }
});
