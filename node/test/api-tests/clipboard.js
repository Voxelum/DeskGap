const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { clipboard } = require('deskgap');

describe('clipboard module', () => {
    it('exposes text and image clipboard operations', () => {
        assert.equal(typeof clipboard.readText, 'function');
        assert.equal(typeof clipboard.writeText, 'function');
        assert.equal(typeof clipboard.writeImage, 'function');
        assert.throws(() => clipboard.writeImage(Buffer.alloc(0)), /NativeImage/);
    });
});