const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, externalWindow } = require('deskgap');

app.on('window-all-closed', () => {});
app.once('ready', async () => {
    const timeout = setTimeout(() => app.exit(1), 15000);
    try {
        assert.equal(externalWindow.isSupported(), true);
        const window = new BrowserWindow({ width: 420, height: 300 });
        window.loadFile(path.join(__dirname, 'page.html'));
        await new Promise(resolve => window.webContents.once('did-finish-load', resolve));

        const expected = { x: 120, y: 140, width: 640, height: 480 };
        await externalWindow.moveAndResize(process.pid, expected, { coordinateSpace: 'dip', timeout: 2000 });
        const [x, y] = window.getPosition();
        const [width, height] = window.getSize();
        assert.ok(Math.abs(x - expected.x) <= 2, `Unexpected x: ${x}`);
        assert.ok(Math.abs(y - expected.y) <= 2, `Unexpected y: ${y}`);
        assert.ok(Math.abs(width - expected.width) <= 2, `Unexpected width: ${width}`);
        assert.ok(Math.abs(height - expected.height) <= 2, `Unexpected height: ${height}`);

        await assert.rejects(
            externalWindow.moveAndResize(0xffffffff, expected, { timeout: 0 }),
            error => error.code === 'ERR_EXTERNAL_WINDOW_NOT_FOUND',
        );
        const controller = new AbortController();
        const pending = externalWindow.moveAndResize(0xffffffff, expected, {
            signal: controller.signal,
            timeout: 10000,
        });
        controller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        window.destroy();
        clearTimeout(timeout);
        process.stdout.write('ok');
        app.exit();
    }
    catch (error) {
        clearTimeout(timeout);
        process.stderr.write(`${error.stack}\n`);
        app.exit(1);
    }
});