const assert = require('node:assert/strict');
const http = require('node:http');
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
function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}
function close(server) {
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function load(sessionInstance, url) {
    const window = new BrowserWindow({
        show: false,
        webPreferences: { engine: 'webview2', session: sessionInstance },
    });
    assert.equal(window.webContents.session, sessionInstance);
    window.loadURL(url);
    return window;
}

app.once('ready', async () => {
    const timeout = setTimeout(() => app.exit(1), 15000);
    const server = http.createServer((request, response) => {
        if (request.url.startsWith('/report')) {
            report(new URL(request.url, 'http://localhost').searchParams.get('value') || '');
            response.end('ok');
            return;
        }
        const setValue = request.url === '/set';
        response.setHeader('content-type', 'text/html');
        response.end(`<!doctype html><script>
            ${setValue ? "localStorage.setItem('deskgap-session-test', 'shared');" : ''}
            fetch('/report?value=' + encodeURIComponent(localStorage.getItem('deskgap-session-test') || ''));
        </script>`);
        if (request.url === '/set') report(request.headers['user-agent'] || '');
    });

    try {
        await listen(server);
        const origin = `http://127.0.0.1:${server.address().port}`;
        const name = `session-test-${process.pid}-${Date.now()}`;
        const sharedSession = session.fromName(name);
        assert.equal(session.fromName(name), sharedSession);
        sharedSession.setUserAgent('DeskGapSessionTest/1.0');

        let window = load(sharedSession, `${origin}/set`);
        const reportedUserAgent = await nextReport();
        assert.equal(reportedUserAgent, 'DeskGapSessionTest/1.0');
        const initialValue = await nextReport();
        assert.equal(initialValue, 'shared');
        assert.throws(() => sharedSession.setUserAgent('changed'), /cannot be changed/);
        window.destroy();

        window = load(sharedSession, `${origin}/get`);
        const sharedValue = await nextReport();
        assert.equal(sharedValue, 'shared');
        window.destroy();

        const sharedWindowA = load(sharedSession, `${origin}/get?window=a`);
        const sharedWindowB = load(sharedSession, `${origin}/get?window=b`);
        const concurrentValues = [await nextReport(), await nextReport()].sort();
        assert.deepEqual(concurrentValues, ['shared', 'shared']);
        sharedWindowA.destroy();
        sharedWindowB.destroy();

        const isolatedSession = session.fromName(`${name}-isolated`);
        window = load(isolatedSession, `${origin}/get`);
        const isolatedValue = await nextReport();
        assert.equal(isolatedValue, '');
        window.destroy();

        const proxyServer = http.createServer((request, response) => {
            report(request.url);
            response.end('<!doctype html><title>proxied</title>');
        });
        await listen(proxyServer);
        const proxySession = session.createEphemeral();
        await proxySession.setProxy({ proxyRules: `http://127.0.0.1:${proxyServer.address().port}` });
        window = load(proxySession, 'http://deskgap-session-proxy.test/path');
        assert.equal(await nextReport(), 'http://deskgap-session-proxy.test/path');
        window.destroy();
        await close(proxyServer);

        await close(server);
        clearTimeout(timeout);
        process.stdout.write('ok');
        app.exit();
    }
    catch (error) {
        if (server.listening) await close(server).catch(() => {});
        clearTimeout(timeout);
        process.stderr.write(`${error.stack}\n`);
        app.exit(1);
    }
});
