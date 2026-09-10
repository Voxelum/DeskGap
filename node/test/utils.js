const path = require('path');
const Koa = require('koa');
const { webViews, BrowserWindow } = require('deskgap');
const { spawn } = require('child_process');
const { once } = require('events');


class DeskGapProcessError extends Error {
    constructor(result) {
        super(`The DeskGap instance exited with a non-zero status: ${result.code}. Signal: ${result.signal}. stdout: ${result.stdout}. stderr: ${result.stderr}`);
        this.result = result;
    }
}

const spawnDeskGapAsync = (entryPath, args) => {
    const spawnedDeskGap = spawn(process.argv0, args, {
        windowsHide: false,
        env: {
            ...process.env,
            'DESKGAP_ENTRY': entryPath
        }
    });

    const stdoutBuffers = [];
    const stderrBuffers = [];
    spawnedDeskGap.stdout.on('data', chunk => stdoutBuffers.push(chunk));
    spawnedDeskGap.stderr.on('data', chunk => stderrBuffers.push(chunk));

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            spawnedDeskGap.kill();
            reject(new Error(`DeskGap fixture timed out: ${entryPath}`));
        }, 30000);
        spawnedDeskGap.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        spawnedDeskGap.once('close', (code, signal) => {
            clearTimeout(timeout);
            const result = {
                stdout: Buffer.concat(stdoutBuffers).toString('utf8'),
                stderr: Buffer.concat(stderrBuffers).toString('utf8'),
                code, signal
            };
            if (code !== 0) {
                reject(new DeskGapProcessError(result));
            }
            else {
                resolve(result);
            }
        });
    });
}

exports.spawnDeskGapAppAsync = (appName, ...args) => {
    return spawnDeskGapAsync(path.join(__dirname, 'fixtures', 'apps', appName), args);
};

exports.createLocalServer = (handlers) => {
    const koa = new Koa();

    koa.use(async (ctx) => {
        const handler = handlers[ctx.path];
        if (handler == null) {
            ctx.status = 404;
            return;
        }
        await handler(ctx);
    });
    
    return new Promise((resolve, reject) => {
        koa.once('error', reject);
        koa.listen(0, 'localhost', function() {
            resolve({
                url: `http://localhost:${this.address().port}`,
                close: () => {
                    this.close();
                },
                whenClose: () => {
                    return new Promise(r => this.on('close', r));
                }
            });
        });
    });
}

const availableWindowsEngines = ['webview2', 'winrt'].filter(engine => webViews.isEngineAvailable(engine));
const engines = process.platform === 'win32' ? availableWindowsEngines : [null];
exports.withWebView = (it, description, func, loadsBlankPage = false) => {
    for (const engine of engines) {
        it(description + (engine == null ? "": `@${engine}`), { timeout: 15000 }, async (testContext) => {
            const win = new BrowserWindow({
                show: false,
                webPreferences: { engine }
            });
            win.webView.on('console-message', event => {
                if (event.level === 'warning' || event.level === 'error') {
                    testContext.diagnostic(`${engine || 'webkit'} ${event.level}: ${event.message}`);
                }
            });
            testContext.after(() => {
                if (!win.isDestroyed()) win.destroy();
            });
            try {
                if (loadsBlankPage) {
                    const loaded = once(win.webView, 'did-finish-load');
                    win.loadFile(path.resolve(__dirname, 'fixtures', 'files', 'blank.html'));
                    await loaded;
                }
                return await func(win, testContext);
            }
            finally {
                if (!win.isDestroyed()) win.destroy();
            }
        });
    }
};
