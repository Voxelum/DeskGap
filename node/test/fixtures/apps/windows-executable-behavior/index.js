const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('deskgap');
const native = process._linkedBinding('__embedder_mod').windowsExecutableNative;

app.on('window-all-closed', () => {});
app.once('ready', async () => {
    const timeout = setTimeout(() => app.exit(1), 120000);
    const directory = path.join(__dirname, `.verify-${process.pid}`);
    let exitCode = 0;
    try {
        assert.equal(typeof native.verifySignature, 'function');
        for (const args of [
            [], [null, []], ['file.exe', []], ['file.exe', 'CN=Wrong'],
            ['file.exe', [1]], ['file.exe', ['']], ['', ['CN=Wrong']],
            ['file.exe\0other.exe', ['CN=Wrong']], ['file.exe', ['CN=Wrong\0']],
            ['file.exe', ['CN=\ud800']], ['file.exe', [,]],
        ]) {
            const promise = native.verifySignature(...args);
            assert.ok(promise instanceof Promise);
            await assert.rejects(promise, TypeError);
        }
        if (process.platform !== 'win32') {
            await assert.rejects(native.verifySignature('file.exe', ['CN=Wrong']), /not supported/i);
        }
        else {
            const signed = process.env.DESKGAP_SIGNED_TEST_EXE;
            const subject = process.env.DESKGAP_SIGNED_TEST_PUBLISHER;
            assert.ok(signed && subject, 'Set DESKGAP_SIGNED_TEST_EXE and its full DESKGAP_SIGNED_TEST_PUBLISHER');
            assert.equal(await native.verifySignature(signed, [subject]), undefined);
            await native.verifySignature(signed, ['CN=Wrong, O=Wrong', subject]);
            await assert.rejects(native.verifySignature(signed, ['CN=Wrong, O=Wrong']), /publisher subject/i);
            await assert.rejects(native.verifySignature(signed, [subject.split(',')[0]]), /publisher subject/i);
            await assert.rejects(native.verifySignature(signed, [subject.toLowerCase()]), /publisher subject/i);
            await assert.rejects(native.verifySignature(process.execPath, [subject]), /no embedded Authenticode signature/i);
            await assert.rejects(native.verifySignature(path.join(directory, 'missing.exe'), [subject]), /Opening executable/i);

            fs.mkdirSync(directory);
            const copy = path.join(directory, '签名-\u{1f512}.exe');
            fs.copyFileSync(signed, copy);
            await native.verifySignature(copy, [subject]);
            const writable = fs.openSync(copy, 'r+');
            try {
                await assert.rejects(native.verifySignature(copy, [subject]), /Opening executable/i);
            }
            finally {
                fs.closeSync(writable);
            }
            const header = Buffer.alloc(4096);
            const file = fs.openSync(copy, 'r');
            fs.readSync(file, header, 0, header.length, 0);
            fs.closeSync(file);
            const pe = header.readUInt32LE(0x3c);
            const optional = pe + 24;
            const directories = header.readUInt16LE(optional) === 0x20b ? 112 : 96;
            const security = optional + directories + 32;
            const certificateOffset = header.readUInt32LE(security);
            const certificateSize = header.readUInt32LE(security + 4);
            const section = optional + header.readUInt16LE(pe + 20);
            const rawOffset = header.readUInt32LE(section + 20);
            const originalByte = Buffer.alloc(1);
            const rawFile = fs.openSync(copy, 'r');
            fs.readSync(rawFile, originalByte, 0, 1, rawOffset);
            fs.closeSync(rawFile);
            async function mutated(offset, bytes, error) {
                const fd = fs.openSync(copy, 'r+');
                const original = Buffer.alloc(bytes.length);
                try {
                    fs.readSync(fd, original, 0, original.length, offset);
                    fs.writeSync(fd, bytes, 0, bytes.length, offset);
                }
                finally {
                    fs.closeSync(fd);
                }
                try {
                    await assert.rejects(native.verifySignature(copy, [subject]), error);
                }
                finally {
                    const restore = fs.openSync(copy, 'r+');
                    fs.writeSync(restore, original, 0, original.length, offset);
                    fs.closeSync(restore);
                }
            }
            const integer = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
            await mutated(rawOffset, Buffer.from([originalByte[0] ^ 0xff]), /Authenticode verification/i);
            await mutated(security, integer(certificateOffset + 1), /aligned suffix/i);
            await mutated(security + 4, integer(certificateSize - 1), /aligned suffix/i);
            await mutated(security, integer(8), /aligned suffix/i);
            await mutated(certificateOffset, integer(certificateSize + 8), /WIN_CERTIFICATE/i);
            await mutated(certificateOffset + 4, Buffer.from([0, 1]), /WIN_CERTIFICATE/i);
            fs.appendFileSync(copy, 'untrusted suffix');
            await assert.rejects(native.verifySignature(copy, [subject]), /aligned suffix/i);
            fs.truncateSync(copy, certificateOffset + certificateSize);
            await native.verifySignature(copy, [subject]);
            // Rename/delete succeeding after both successful and failed verification checks handle cleanup.
            const renamed = path.join(directory, 'released.exe');
            fs.renameSync(copy, renamed);
            fs.unlinkSync(renamed);
        }
        process.stdout.write('ok');
    }
    catch (error) {
        process.stderr.write(`${error.stack}\n`);
        exitCode = 1;
    }
    finally {
        clearTimeout(timeout);
        fs.rmSync(directory, { recursive: true, force: true });
    }
    app.exit(exitCode);
});
