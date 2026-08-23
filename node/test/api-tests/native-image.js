const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { nativeImage } = require('deskgap');

const bitmap = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
]);

describe('nativeImage module', () => {
    it('creates an empty image', () => {
        assert.equal(nativeImage.createEmpty().isEmpty(), true);
    });

    it('creates, crops, and resizes a bitmap', () => {
        const image = nativeImage.createFromBitmap(bitmap, {
            width: 2,
            height: 1,
            scaleFactor: 1,
        });

        assert.equal(image.isEmpty(), false);
        assert.deepEqual(image.getSize(), { width: 2, height: 1 });
        assert.equal(image.getAspectRatio(), 2);
        assert.deepEqual(image.toBitmap(), bitmap);
        assert.deepEqual(image.crop({ x: 1, y: 0, width: 1, height: 1 }).toBitmap(), bitmap.subarray(4));
        assert.deepEqual(image.resize({ width: 4 }).getSize(), { width: 4, height: 2 });
    });

    it('encodes and decodes PNG and JPEG data', () => {
        const image = nativeImage.createFromBitmap(bitmap, {
            width: 2,
            height: 1,
            scaleFactor: 1,
        });
        const png = image.toPNG();
        const jpeg = image.toJPEG(80);

        assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        assert.deepEqual(jpeg.subarray(0, 2), Buffer.from([255, 216]));
        assert.deepEqual(nativeImage.createFromBuffer(png).getSize(), { width: 2, height: 1 });
        assert.deepEqual(nativeImage.createFromBuffer(jpeg).getSize(), { width: 2, height: 1 });
    });

    it('adds encoded and bitmap representations', () => {
        const image = nativeImage.createEmpty();
        image.addRepresentation({
            buffer: Buffer.concat([bitmap, bitmap, bitmap, bitmap]),
            width: 4,
            height: 2,
            scaleFactor: 2,
        });

        assert.deepEqual(image.getScaleFactors(), [2]);
        assert.deepEqual(image.getSize(2), { width: 2, height: 1 });

        image.addRepresentation({ buffer: image.toPNG({ scaleFactor: 2 }), scaleFactor: 1 });
        assert.deepEqual(image.getScaleFactors(), [1, 2]);
    });
});