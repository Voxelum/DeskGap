const { app, BrowserWindow, messageNode } = require('deskgap');
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createLocalServer, withWebView } = require('../utils');
const { once } = require('events');
const path = require('path');

describe('BrowserWindow#webView', () => {
    const windowAllClosedHandler = () => {};

    before(async () => {
        app.on('window-all-closed', windowAllClosedHandler);
        await app.whenReady();
    });
    after(() => {
        app.removeListener('window-all-closed', windowAllClosedHandler);
    });

    it('has an alias: BrowserWindow#webContents', () => {
        const win = new BrowserWindow({show:false});
        assert.equal(win.webView, win.webContents);
        win.destroy();
    });

    describe('webView.trySuspend()', () => {
        withWebView(it, 'suspends loaded hidden content', async (win) => {
            const suspended = await win.webView.trySuspend();
            assert.equal(suspended, win.webView.engine === 'webview2');
            win.webView.resume();
        }, true);
    });

    describe('webView.loadURL(url)', () => {
        withWebView(it, 'loads the page by requesting the url', async (win, testContext) => {
            if (win.webView.engine === 'winrt') return testContext.skip();
            let resolve;
            let requested = false;
            const server = await createLocalServer({
                '/index.html': async ctx => {
                    requested = true;
                    resolve();
                }
            });
            
            win.webView.loadURL(server.url + '/index.html');
            await new Promise(r => resolve = r);
            assert.equal(requested, true);
            server.close();
        });

        withWebView(it, 'emits navigation lifecycle events', async (win, testContext) => {
            if (win.webView.engine !== 'webview2') return testContext.skip();
            const server = await createLocalServer({
                '/redirect': async ctx => ctx.redirect('/final'),
                '/final': async ctx => { ctx.body = '<!doctype html><title>done</title>'; },
            });
            const started = once(win.webView, 'did-start-navigation');
            const redirected = once(win.webView, 'did-redirect-navigation');
            const finished = once(win.webView, 'did-finish-load');
            try {
                win.webView.loadURL(server.url + '/redirect');
                const [, startURL, isInPlace, isMainFrame] = await started;
                assert.equal(startURL, server.url + '/redirect');
                assert.equal(isInPlace, false);
                assert.equal(isMainFrame, true);
                const [, redirectURL] = await redirected;
                assert.equal(redirectURL, server.url + '/final');
                await finished;
            }
            finally {
                server.close();
            }
        });

        withWebView(it, 'emits did-fail-load without did-finish-load', async (win, testContext) => {
            if (win.webView.engine !== 'webview2') return testContext.skip();
            const server = await createLocalServer({});
            const unavailableURL = server.url + '/unavailable';
            const closed = server.whenClose();
            server.close();
            await closed;

            let finished = false;
            win.webView.once('did-finish-load', () => { finished = true; });
            const failed = once(win.webView, 'did-fail-load');
            win.webView.loadURL(unavailableURL);
            const [, errorCode, errorDescription, validatedURL, isMainFrame] = await failed;
            assert.equal(typeof errorCode, 'number');
            assert.equal(errorDescription.length > 0, true);
            assert.equal(validatedURL, unavailableURL);
            assert.equal(isMainFrame, true);
            assert.equal(finished, false);
        });
    });

    describe('webView.loadFile(path)', () => {
        withWebView(it, 'loads the given file', (win) => new Promise(resolve =>{
            win.webView.handle('test.loaded', () => resolve());
            win.webView.loadFile(path.resolve(__dirname, '..', 'fixtures', 'files', 'web-view-load-file.html'));
        }))
    });

    describe('webView.handle(name, handler)', () => {
        withWebView(it, 'receives values reported by the browser', async (win) => {
            const resultFromBrowser = new Promise(resolve => {
                win.webView.handle('test.browser-value', (_context, value) => resolve(value));
            });
            win.webView.loadFile(path.resolve(__dirname, '..', 'fixtures', 'files', 'web-view-side-services.html'));
            assert.deepEqual(await resultFromBrowser, { answer: 42 });
        });
    });
});
