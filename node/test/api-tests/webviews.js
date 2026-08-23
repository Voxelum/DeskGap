const { webViews, BrowserWindow } = require('deskgap');
const assert = require('node:assert/strict');
const { afterEach, before, beforeEach, describe, it } = require('node:test');
const { once } = require('events');
const isElevated = require('is-elevated');
const os = require('os');
const path = require('path');

const win = process.platform === 'win32';
const win1809 = win && (() => {
    const gte = (release1, release2) => {
        for (let i = 0; i < release2.length; ++i) {
            const r1 = release1[i];
            const r2 = release2[i];
            if (r1 == null || isNaN(r1) || r1 < r2) {
                return false;
            }
            if (r1 > r2) {
                return true;
            }
        }
        return true;
    }
    const releaseString = os.release();
    const release = releaseString.split('.').map(n => parseInt(n, 10));
    return gte(release, [10, 0, 17763]);
});

describe('webViews', () => {
    describe('webViews.isEngineAvailable(engine)', () => {
        let isAdmin;
        before(async () => {
            isAdmin = await isElevated();
        });
        it('should return false if the os is not Windows', (testContext) => {
            if (win) return testContext.skip();
            for (const engine of ["webview2", "winrt"]) {
                assert.equal(webViews.isEngineAvailable(engine), false);
            }
        });

        it('should return false for the removed Trident engine', () => {
            assert.equal(webViews.isEngineAvailable('trident'), false);
        });

        it('should return true for "winrt" if the Windows version is 10.0.17763 or higher and the user is not Administrator', (testContext) => {
            if (!win1809 || isAdmin) return testContext.skip();
            assert.equal(webViews.isEngineAvailable('winrt'), true);
        });
            
            
        it('should return false for "winrt" if the Windows version is lower that 10.0.17763 or the user is Administrator', (testContext) => {
            if (win && (!win1809 || isAdmin)) {
                assert.equal(webViews.isEngineAvailable('winrt'), false);
            }
            else {
                testContext.skip();
            }
        });
    });

    describe('webViews.getDefaultEngine()', () => {
        it('should return null if the os is not Windows', (testContext) => {
            if (win) return testContext.skip();
            assert.equal(webViews.getDefaultEngine(), null);
        });

        it('should initially return "webview2" on Windows if WebView2 is supported', (testContext) => {
            if (!webViews.isEngineAvailable('webview2')) return testContext.skip();
            assert.equal(webViews.getDefaultEngine(), 'webview2');
        });

        it('should initially return "winrt" if WebView2 is unavailable and WinRT is supported', (testContext) => {
            if (webViews.isEngineAvailable('webview2') || !webViews.isEngineAvailable('winrt')) return testContext.skip();
            assert.equal(webViews.getDefaultEngine(), 'winrt');
        });

        it('should initially return null on Windows if no supported engine is available', (testContext) => {
            if (!win || webViews.isEngineAvailable('webview2') || webViews.isEngineAvailable('winrt')) return testContext.skip();
            assert.equal(webViews.getDefaultEngine(), null);
        });
    });

    describe('webViews.setDefaultEngine(engine)', () => {
        let initialEngine = null;
        beforeEach(() => {
            initialEngine = webViews.getDefaultEngine();
        });
        afterEach(() => {
            if (initialEngine != null) webViews.setDefaultEngine(initialEngine);
        });

        it('should change the return value of getDefaultEngine()', (testContext) => {
            const availableEngines = ["webview2", "winrt"].filter(engine => webViews.isEngineAvailable(engine));
            if (availableEngines.length === 0) return testContext.skip();
            for (const engine of availableEngines) {
                webViews.setDefaultEngine(engine);
                assert.equal(webViews.getDefaultEngine(), engine);
            }
        });

        it('should reject the removed Trident engine', () => {
            assert.throws(() => webViews.setDefaultEngine('trident'), {
                name: 'TypeError',
                message: 'Unsupported webview engine: trident'
            });
        });

        it('should change the engine of webviews created afterwards to WebView2 if "webview2" is passed', async (testContext) => {
            if (!webViews.isEngineAvailable('webview2')) return testContext.skip();
            webViews.setDefaultEngine('webview2');
            const window = new BrowserWindow({ show: false });
            const userAgent = new Promise(resolve => {
                window.webView.handle('test.user-agent', (_context, value) => resolve(value));
            });
            window.loadFile(path.resolve(__dirname, '..', 'fixtures', 'files', 'web-view-ua-service.html'));
            assert.match(await userAgent, /Edg\//);
            window.destroy();
        });

        it('should change the engine of webviews created afterwards to a WebKit-like one if "winrt" is passed', async (testContext) => {
            if (!webViews.isEngineAvailable('winrt')) return testContext.skip();

            webViews.setDefaultEngine('winrt');
            const window = new BrowserWindow({ show: false });
            const userAgent = new Promise(resolve => {
                window.webView.handle('test.user-agent', (_context, value) => resolve(value));
            });
            window.loadFile(path.resolve(__dirname, '..', 'fixtures', 'files', 'web-view-ua-service.html'));
            assert.match(await userAgent, /WebKit/);
            window.destroy();
        });
        
    });

});
