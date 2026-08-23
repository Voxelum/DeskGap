const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { app, BrowserWindow, session } = require('deskgap');

const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
});

app.once('ready', async () => {
    const server = http.createServer((request, response) => {
        if (request.url === '/redirect') {
            response.writeHead(302, { Location: '/final' });
            response.end();
        }
        else {
            response.end('<!doctype html><title>done</title>');
        }
    });
    const window = new BrowserWindow({ show: false, webPreferences: { engine: 'webview2', session: session.createEphemeral() } });
    const timeout = setTimeout(() => {
        process.stderr.write('Timed out waiting for navigation lifecycle events\n');
        app.exit(1);
    }, 10000);

    try {
        await listen(server);
        const origin = `http://127.0.0.1:${server.address().port}`;
        const started = once(window.webContents, 'did-start-navigation');
        const redirected = once(window.webContents, 'did-redirect-navigation');
        const finished = once(window.webContents, 'did-finish-load');
        window.loadURL(`${origin}/redirect`);

        const [, startURL, isInPlace, isMainFrame] = await started;
        assert.equal(startURL, `${origin}/redirect`);
        assert.equal(isInPlace, false);
        assert.equal(isMainFrame, true);
        const [, redirectURL] = await redirected;
        assert.equal(redirectURL, `${origin}/final`);
        await finished;
        await close(server);

        const unavailableServer = http.createServer();
        await listen(unavailableServer);
        const unavailableURL = `http://127.0.0.1:${unavailableServer.address().port}/unavailable`;
        await close(unavailableServer);

        let didFinishFailedNavigation = false;
        window.webContents.once('did-finish-load', () => { didFinishFailedNavigation = true; });
        const failed = once(window.webContents, 'did-fail-load');
        window.loadURL(unavailableURL);
        const [, errorCode, description, validatedURL, failedMainFrame] = await failed;
        assert.equal(typeof errorCode, 'number');
        assert.equal(description.length > 0, true);
        assert.equal(validatedURL, unavailableURL);
        assert.equal(failedMainFrame, true);
        assert.equal(didFinishFailedNavigation, false);

        clearTimeout(timeout);
        process.stdout.write('ok');
        window.destroy();
        app.exit();
    }
    catch (error) {
        clearTimeout(timeout);
        if (server.listening) await close(server).catch(() => {});
        process.stderr.write(`${error.stack}\n`);
        window.destroy();
        app.exit(1);
    }
});
