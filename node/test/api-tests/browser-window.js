const { app, BrowserWindow } = require('deskgap');
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const path = require('path');

const mac = process.platform === 'darwin';

describe('BrowserWindow module', () => {
    const windowAllClosedHandler = () => {};
    
    before(async () => {
        app.on('window-all-closed', windowAllClosedHandler);
        await app.whenReady();
    });
    after(() => {
        app.removeListener('window-all-closed', windowAllClosedHandler);
    });

    describe('window state', () => {
        it('controls visibility, minimized, and maximized state', () => {
            const win = new BrowserWindow({ show: false });
            try {
                assert.equal(win.isVisible(), false);
                win.show();
                assert.equal(win.isVisible(), true);
                win.hide();
                assert.equal(win.isVisible(), false);
                win.show();
                win.minimize();
                assert.equal(win.isMinimized(), true);
                win.restore();
                assert.equal(win.isMinimized(), false);
                win.maximize();
                assert.equal(win.isMaximized(), true);
                win.unmaximize();
                assert.equal(win.isMaximized(), false);
            }
            finally {
                win.destroy();
            }
        });

        it('exposes mutable maximizable and minimizable properties', () => {
            const win = new BrowserWindow({ show: false, maximizable: false, minimizable: false });
            try {
                assert.equal(win.maximizable, false);
                assert.equal(win.minimizable, false);
                win.maximizable = true;
                win.minimizable = true;
                assert.equal(win.maximizable, true);
                assert.equal(win.minimizable, true);
            }
            finally {
                win.destroy();
            }
        });

        it('sets an aspect ratio and exposes a native handle', () => {
            const win = new BrowserWindow({ show: true });
            try {
                win.setAspectRatio(16 / 9, { width: 0, height: 40 });
                assert.throws(() => win.setAspectRatio(-1), /Aspect ratio/);
                const handle = win.getNativeWindowHandle();
                assert.equal(Buffer.isBuffer(handle), true);
                if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'wayland') {
                    assert.equal(handle.length > 0, true);
                }
            }
            finally {
                win.destroy();
            }
        });

        it('emits window-state events and controls fullscreen', async () => {
            const win = new BrowserWindow({ show: true });
            const events = [];
            const completed = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error(`Timed out waiting for window events: ${events.join(',')}`)), 1000);
                win.once('leave-full-screen', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            for (const event of ['minimize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
                win.on(event, () => events.push(event));
            }
            try {
                win.minimize();
                win.restore();
                win.maximize();
                win.unmaximize();
                win.fullScreen = true;
                assert.equal(win.fullScreen, true);
                win.fullScreen = false;
                assert.equal(win.isFullScreen(), false);
                win.flashFrame(true);
                win.flashFrame(false);
                await completed;
                const expectedEvents = [
                    'minimize',
                    'restore',
                    'maximize',
                    'unmaximize',
                    'enter-full-screen',
                    'leave-full-screen',
                ].join(',');
                assert.equal(events.join(','), expectedEvents);
            }
            finally {
                win.destroy();
            }
        });
    });

    describe('win.close()', () => {
        it('destroys the window if not prevented', () => {
            const win = new BrowserWindow({ show: false });
            assert.equal(win.isDestroyed(), false);
            win.close();
            assert.equal(win.isDestroyed(), true);
        });
        it('can be prevented in a close event', () => {
            const win = new BrowserWindow({ show: false });
            win.once('close', e => e.preventDefault());
            win.close();
            assert.equal(win.isDestroyed(), false);
            win.close();
            assert.equal(win.isDestroyed(), true);
        });
    });
    describe('win.destroy()', () => {
        it('destroys the window without emitting a close event', () => {
            const win = new BrowserWindow({ show: false });
            win.on('close', () => { throw new Error(); });
            assert.equal(win.isDestroyed(), false);
            win.destroy();
            assert.equal(win.isDestroyed(), true);
        });
        it('should not crash when destroying windows with pending events', () => {
            const win = new BrowserWindow({ show: false });
            win.loadFile(path.resolve(__dirname, '..', 'fixtures', 'files', 'blank.html'));
            win.destroy();
            assert.equal(win.isDestroyed(), true);
        })
    });
    describe('win.setMenu(menu)', () => {
        it('should not throw when it is called after the window has been shown', (testContext) => {
            if (mac) return testContext.skip();
            const win = new BrowserWindow();
            win.setMenu(null);
            win.destroy();
        });
        it('should not throw when it is called before the window has been shown', (testContext) => {
            if (mac) return testContext.skip();
            const win = new BrowserWindow({ show: false });
            win.setMenu(null);
            win.show();
            win.destroy();
        });
    });
    describe('menu bar visibility', () => {
        it('supports automatic and explicit visibility on Windows and Linux', (testContext) => {
            if (mac) return testContext.skip();
            const win = new BrowserWindow({ show: false, autoHideMenuBar: true });
            assert.equal(win.isMenuBarAutoHide(), true);
            assert.equal(win.isMenuBarVisible(), false);
            win.setMenuBarVisibility(true);
            assert.equal(win.isMenuBarVisible(), true);
            win.setAutoHideMenuBar(false);
            assert.equal(win.isMenuBarAutoHide(), false);
            assert.equal(win.isMenuBarVisible(), true);
            win.destroy();
        });
    });
    describe('win.setTitleBarStyle(style)', () => {
        it('should not change the frame of the window', (testContext) => {
            if (process.platform !== 'darwin') return testContext.skip();
            const win = new BrowserWindow({ show: false });
            const size = win.getSize();
            const position = win.getPosition();

            for (const style of ['hidden', 'hiddenInset', 'default']) {
                win.setTitleBarStyle(style);
                assert.deepEqual(win.getSize(), size);
                assert.deepEqual(win.getPosition(), position);
            }
        });
    });
});
