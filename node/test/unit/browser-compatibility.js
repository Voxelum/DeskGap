const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { buildSync } = require('esbuild');

function bundle(file, options = {}) {
    return buildSync({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '../../js', file)],
        write: false,
        platform: 'browser',
        format: 'cjs',
        target: 'es2015',
        ...options,
    }).outputFiles[0].text;
}

const codecSource = bundle('common\\utf8.ts');
const codecs = { exports: {} };
vm.runInNewContext(codecSource, {
    module: codecs,
    exports: codecs.exports,
    Uint8Array,
    TextEncoder: undefined,
    TextDecoder: undefined,
});
const { encodeUTF8, decodeUTF8 } = codecs.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('EdgeHTML UTF-8 encoding matches the standard encoder for Unicode and lone surrogates', () => {
    for (const text of ['', 'hello 你好 👋', '\ud800', '\udfff', '\ud800x\udfff', '\ufeffabc', '\u0000\u07ff\u0800\uffff']) {
        assert.deepEqual(encodeUTF8(text), encoder.encode(text));
    }
    const codeUnits = Array.from({ length: 0x10000 }, (_, value) => String.fromCharCode(value)).join('');
    assert.deepEqual(encodeUTF8(codeUnits), encoder.encode(codeUnits));
});

test('EdgeHTML UTF-8 decoding matches replacement and BOM rules', () => {
    const samples = [
        [], [0xef, 0xbb, 0xbf], [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf],
        [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
        [0xf0, 0x9f, 0x91, 0x8b], [0xf0, 0x9f], [0xe1, 0x80, 0x41],
    ];
    for (const sample of samples) {
        const bytes = new Uint8Array(sample);
        assert.equal(decodeUTF8(bytes), decoder.decode(bytes));
    }
    for (let value = 0; value < 0x10000; value++) {
        const bytes = new Uint8Array([value >> 8, value & 0xff]);
        assert.equal(decodeUTF8(bytes), decoder.decode(bytes));
    }
    let seed = 42;
    for (let sample = 0; sample < 4096; sample++) {
        const bytes = new Uint8Array(8);
        for (let index = 0; index < bytes.length; index++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            bytes[index] = seed >>> 24;
        }
        assert.equal(decodeUTF8(bytes), decoder.decode(bytes));
    }
});

test('EdgeHTML EventTarget compatibility retains native dispatch and subclass methods', () => {
    function UnconstructibleEventTarget() { throw new TypeError('Function expected'); }
    UnconstructibleEventTarget.prototype = EventTarget.prototype;
    Object.setPrototypeOf(UnconstructibleEventTarget, EventTarget);
    const context = {
        EventTarget: UnconstructibleEventTarget,
        Event,
        document: { createDocumentFragment: () => new EventTarget() },
    };
    context.window = context;
    vm.runInNewContext(bundle('ui\\compatibility.ts', { format: 'iife' }), context);
    const target = vm.runInNewContext(`
        class DeskGapTarget extends EventTarget {
            check() { return 42; }
        }
        new DeskGapTarget();
    `, context);
    assert.equal(target.check(), 42);
    let calls = 0;
    target.addEventListener('probe', event => {
        assert.equal(event.target, target);
        calls++;
        event.preventDefault();
    }, { once: true });
    assert.equal(target.dispatchEvent(new Event('probe', { cancelable: true })), false);
    assert.equal(target.dispatchEvent(new Event('probe', { cancelable: true })), true);
    assert.equal(calls, 1);
    const listener = () => calls++;
    target.addEventListener('removed', listener);
    target.removeEventListener('removed', listener);
    target.dispatchEvent(new Event('removed'));
    assert.equal(calls, 1);
});

test('modern browsers retain their native EventTarget constructor', () => {
    const context = { EventTarget };
    context.window = context;
    vm.runInNewContext(bundle('ui\\compatibility.ts', { format: 'iife' }), context);
    assert.equal(context.EventTarget, EventTarget);
});
