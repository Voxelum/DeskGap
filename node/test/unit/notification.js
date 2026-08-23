const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-notification-'));
const outputFile = path.join(outputDirectory, 'notification.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/notification.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const nativeInstances = [];
class NativeImageNative {
    constructor(type, imagePath) {
        this.type = type;
        this.imagePath = imagePath;
    }
    isEmpty() { return false; }
    toPNG() { return Buffer.from('png'); }
}
class NotificationNative {
    static isSupported() { return true; }
    constructor(options, callbacks) {
        this.options = options;
        this.callbacks = callbacks;
        nativeInstances.push(this);
    }
    show() { this.showCalled = true; }
    close() { this.closeCalled = true; }
}
global.__embedder_mod = { NativeImageNative, NotificationNative };
const { Notification } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => nativeInstances.length = 0);

test('validates options and converts path icons to PNG', () => {
    assert.throws(() => new Notification({}), /title/);
    const notification = new Notification({
        title: 'Finished',
        body: 'Continue',
        icon: 'icon.png',
        silent: true,
    });
    assert.ok(notification);
    assert.equal(nativeInstances[0].options.title, 'Finished');
    assert.equal(nativeInstances[0].options.body, 'Continue');
    assert.equal(nativeInstances[0].options.iconPng.toString(), 'png');
    assert.equal(nativeInstances[0].options.silent, true);
});

test('rejects oversized notification icons', () => {
    const icon = {
        isEmpty() { return false; },
        toPNG() { return Buffer.alloc(5 * 1024 * 1024 + 1); },
    };
    assert.throws(() => new Notification({ title: 'Large', icon }), /5 MiB/);
});

test('forwards lifecycle events from the native notification', () => {
    const notification = new Notification({ title: 'Task finished' });
    const events = [];
    notification.on('show', () => events.push('show'));
    notification.on('click', () => events.push('click'));
    notification.on('close', () => events.push('close'));
    notification.on('failed', (_event, message) => events.push(`failed:${message}`));

    notification.show();
    assert.deepEqual(events, []);
    nativeInstances[0].callbacks.onShow();
    nativeInstances[0].callbacks.onClick();
    nativeInstances[0].callbacks.onFailed('denied');
    notification.close();
    nativeInstances[0].callbacks.onClose();
    assert.deepEqual(events, ['show', 'click', 'failed:denied', 'close']);
    assert.equal(nativeInstances[0].closeCalled, true);
    assert.equal(Notification.isSupported(), true);
});
