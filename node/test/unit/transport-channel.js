const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-channel-'));
const outputFile = path.join(outputDirectory, 'transport-channel.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/common/transport-channel.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { bridgeChannels, initialChannelCreditBytes, TransportChannel } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

function channelPair() {
    let first;
    let second;
    const firstControls = [];
    const route = (peer, frame) => {
        if (frame.type === 'channel-credit') peer.grantCredit(frame.bytes);
        else if (frame.type === 'channel-close') peer.remoteClose(frame.code, frame.reason);
    };
    first = new TransportChannel(1, {
        sendBinary(_id, data) { second.receive(data); },
        sendControl(frame) {
            if (second) route(second, frame);
            else firstControls.push(frame);
        },
    });
    second = new TransportChannel(1, {
        sendBinary(_id, data) { first.receive(data); },
        sendControl(frame) { route(first, frame); },
    });
    for (const frame of firstControls) route(second, frame);
    return [first, second];
}

test('blocks writers at the credit window until the reader consumes', async () => {
    const [sender, receiver] = channelPair();
    const writer = sender.writable.getWriter();
    const payload = new Uint8Array(initialChannelCreditBytes + 32 * 1024).fill(7);
    let completed = false;
    const writing = writer.write(payload).then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);

    const reader = receiver.readable.getReader();
    const first = await reader.read();
    assert.equal(first.value.byteLength, initialChannelCreditBytes);
    await writing;
    assert.equal(completed, true);
    const second = await reader.read();
    assert.equal(second.value.byteLength, 32 * 1024);
    await writer.close();
    assert.equal((await reader.read()).done, true);
});

test('delivers binary data in both directions', async () => {
    const [first, second] = channelPair();
    const firstWriter = first.writable.getWriter();
    const secondWriter = second.writable.getWriter();
    const firstReader = first.readable.getReader();
    const secondReader = second.readable.getReader();

    await Promise.all([
        firstWriter.write(Uint8Array.from([1, 2, 3])),
        secondWriter.write(Uint8Array.from([4, 5])),
    ]);
    assert.deepEqual(Array.from((await secondReader.read()).value), [1, 2, 3]);
    assert.deepEqual(Array.from((await firstReader.read()).value), [4, 5]);
});

test('rejects receive-window overflow', async () => {
    let closeFrame;
    const channel = new TransportChannel(3, {
        sendBinary() {},
        sendControl(frame) {
            if (frame.type === 'channel-close') closeFrame = frame;
        },
    });
    channel.receive(new Uint8Array(initialChannelCreditBytes));
    channel.receive(new Uint8Array(1));
    assert.equal(closeFrame.code, 1009);
    assert.equal((await channel.readable.getReader().read()).done, true);
});

test('brokers two browser-facing channels through the main thread', async () => {
    const [firstMain, firstBrowser] = channelPair();
    const [secondMain, secondBrowser] = channelPair();
    const stop = bridgeChannels(firstMain, secondMain);
    const firstWriter = firstBrowser.writable.getWriter();
    const secondReader = secondBrowser.readable.getReader();
    const secondWriter = secondBrowser.writable.getWriter();
    const firstReader = firstBrowser.readable.getReader();

    await firstWriter.write(Uint8Array.from([7, 8, 9]));
    assert.deepEqual(Array.from((await secondReader.read()).value), [7, 8, 9]);
    await secondWriter.write(Uint8Array.from([3, 2, 1]));
    assert.deepEqual(Array.from((await firstReader.read()).value), [3, 2, 1]);
    stop();
});

test('rejects blocked writers when close-frame delivery fails', async () => {
    const channel = new TransportChannel(5, {
        sendBinary() {},
        sendControl(frame) {
            if (frame.type === 'channel-close') throw new Error('transport unavailable');
        },
    });
    const writer = channel.writable.getWriter();
    const writing = writer.write(Uint8Array.from([1]));
    channel.close(1006, 'Transport disconnected');
    await assert.rejects(writing, /Transport disconnected/);
});
