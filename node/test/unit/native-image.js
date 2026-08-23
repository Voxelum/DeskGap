const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-native-image-'));
const outputFile = path.join(outputDirectory, 'native-image.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/native-image.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const instances = [];
class NativeImageNative {
    constructor(...args) {
        this.constructorArguments = args;
        instances.push(this);
    }

    addRepresentation(...args) {
        this.addRepresentationArguments = args;
    }
}

global.__embedder_mod = { NativeImageNative };
const { nativeImage } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => instances.length = 0);

test('creates encoded and bitmap images with native options', () => {
    const encoded = Buffer.from('encoded');
    const bitmap = Buffer.alloc(24);

    nativeImage.createFromBuffer(encoded, { scaleFactor: 2 });
    assert.deepEqual(instances[0].constructorArguments, [1, encoded, 2]);

    nativeImage.createFromBuffer(bitmap, { width: 3, height: 2, scaleFactor: 2 });
    assert.deepEqual(instances[1].constructorArguments, [2, bitmap, 3, 2, 2]);

    nativeImage.createFromBitmap(bitmap, { width: 3, height: 2, scaleFactor: 1 });
    assert.deepEqual(instances[2].constructorArguments, [2, bitmap, 3, 2, 1]);
});

test('adds encoded and bitmap representations', () => {
    const image = nativeImage.createEmpty();
    const encoded = Buffer.from('encoded');
    const bitmap = Buffer.alloc(24);

    image.addRepresentation({ buffer: encoded, scaleFactor: 2 });
    assert.deepEqual(instances[0].addRepresentationArguments, [encoded, undefined, undefined, 2]);

    image.addRepresentation({ buffer: bitmap, width: 3, height: 2, scaleFactor: 1 });
    assert.deepEqual(instances[0].addRepresentationArguments, [bitmap, 3, 2, 1]);
});

test('validates bitmap dimensions and data URLs before native calls', () => {
    assert.throws(
        () => nativeImage.createFromBuffer(Buffer.alloc(4), { width: 1 }),
        /width and height/
    );
    assert.throws(
        () => nativeImage.createEmpty().addRepresentation({ buffer: Buffer.alloc(4), height: 1 }),
        /width and height/
    );
    assert.throws(() => nativeImage.createFromDataURL('data:text/plain;base64,QQ=='), /data URL/i);
});