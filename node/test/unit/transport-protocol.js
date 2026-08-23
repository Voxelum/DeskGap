const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-protocol-'));
const outputFile = path.join(outputDirectory, 'transport-protocol.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/common/transport-protocol.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const protocol = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('round-trips binary channel frames without copying into JSON', () => {
    const source = Uint8Array.from([0, 1, 2, 255]);
    const encoded = protocol.encodeChannelDataFrame(17, source);
    const decoded = protocol.decodeChannelDataFrame(encoded);
    assert.equal(decoded.channelId, 17);
    assert.deepEqual(Array.from(decoded.payload), Array.from(source));
});

test('validates channel control frames and binary headers', () => {
    assert.deepEqual(protocol.decodeTransportFrame(JSON.stringify({
        version: 1,
        type: 'channel-credit',
        channelId: 2,
        bytes: 1024,
    })), {
        version: 1,
        type: 'channel-credit',
        channelId: 2,
        bytes: 1024,
    });
    assert.throws(() => protocol.decodeTransportFrame(JSON.stringify({
        version: 1,
        type: 'channel-credit',
        channelId: 0,
        bytes: -1,
    })), /invalid/);
    assert.throws(() => protocol.decodeChannelDataFrame(new Uint8Array([1, 2, 3, 4])), /Invalid/);
});
