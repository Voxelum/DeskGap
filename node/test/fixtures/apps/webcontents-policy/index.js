const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { app, BrowserWindow, session } = require('deskgap');

app.on('window-all-closed', () => {});

const reports = [];
const waiters = [];
function report(value) {
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else reports.push(value);
}
function nextReport() {
    if (reports.length > 0) return Promise.resolve(reports.shift());
    return new Promise(resolve => waiters.push(resolve));
}
function page(script) {
    return `<!doctype html><script>${script}</script>`;
}

app.once('ready', async () => {
    const timeout = setTimeout(() => app.exit(1), 15000);
    const server = http.createServer((request, response) => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        if (request.url.startsWith('/report')) {
            report(new URL(request.url, origin).searchParams.get('value') || '');
            response.end('ok');
            return;
        }
        response.setHeader('content-type', 'text/html');
        if (request.url === '/blocked-source') {
            response.end(page(`location.href='/blocked-target'; setTimeout(() => fetch('/report?value=stayed'), 300);`));
        }
        else if (request.url === '/blocked-target') {
            response.end(page(`fetch('/report?value=blocked');`));
        }
        else if (request.url === '/allowed-source') {
            response.end(page(`location.href='/allowed-target';`));
        }
        else if (request.url === '/allowed-target') {
            response.end(page(`fetch('/report?value=allowed');`));
        }
        else if (request.url === '/popup-deny') {
            response.end(page(`window.open('/denied-child', 'denied'); setTimeout(() => fetch('/report?value=deny-opener'), 100);`));
        }
        else if (request.url === '/popup-allow') {
            response.end(page(`window.open('/allowed-child', 'app', 'width=640,height=480');`));
        }
        else if (request.url === '/console') {
            response.end(page(`console.warn('launcher-log', { answer: 42 }); fetch('/report?value=console-page-loaded');`));
        }
        else if (request.url === '/allowed-child') {
            response.end(page(`fetch('/report?value=child');`));
        }
        else {
            response.end(page(`fetch('/report?value=unexpected');`));
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const window = new BrowserWindow({ show: false, webPreferences: { engine: 'webview2', session: session.createEphemeral() } });
    let child;

    try {
        window.webContents.on('will-navigate', (event, url) => {
            if (url === `${origin}/blocked-target`) event.preventDefault();
        });
        window.loadURL(`${origin}/blocked-source`);
        assert.equal(await nextReport(), 'stayed');

        window.loadURL(`${origin}/allowed-source`);
        assert.equal(await nextReport(), 'allowed');

        const consoleMessage = once(window.webContents, 'console-message');
        window.loadURL(`${origin}/console`);
        assert.equal(await nextReport(), 'console-page-loaded');
        const [consoleEvent] = await Promise.race([
            consoleMessage,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for console-message')), 1000)),
        ]);
        assert.equal(consoleEvent.level, 'warning');
        assert.equal(consoleEvent.message, 'launcher-log {"answer":42}');

        window.loadURL(`${origin}/popup-deny`);
        assert.equal(await nextReport(), 'deny-opener');
        assert.equal(BrowserWindow.getAllWindows().length, 1);

        let deniedDetails;
        window.webContents.setWindowOpenHandler(details => {
            deniedDetails = details;
            return { action: 'deny' };
        });
        window.loadURL(`${origin}/popup-deny`);
        assert.equal(await nextReport(), 'deny-opener');
        assert.equal(deniedDetails.url, `${origin}/denied-child`);
        assert.equal(deniedDetails.frameName, 'denied');

        window.webContents.setWindowOpenHandler(details => ({
            action: details.frameName === 'app' ? 'allow' : 'deny',
            overrideBrowserWindowOptions: { show: false, width: 640, height: 480 },
        }));
        const created = once(window.webContents, 'did-create-window');
        window.loadURL(`${origin}/popup-allow`);
        const [, createdWindow, details] = await created;
        child = createdWindow;
        assert.equal(details.url, `${origin}/allowed-child`);
        assert.equal(details.frameName, 'app');
        assert.equal(child.webContents.session, window.webContents.session);
        assert.equal(await nextReport(), 'child');

        clearTimeout(timeout);
        process.stdout.write('ok');
        child.destroy();
        window.destroy();
        server.close(() => app.exit());
    }
    catch (error) {
        clearTimeout(timeout);
        process.stderr.write(`${error.stack}\n`);
        if (child && !child.isDestroyed()) child.destroy();
        if (!window.isDestroyed()) window.destroy();
        server.close(() => app.exit(1));
    }
});
