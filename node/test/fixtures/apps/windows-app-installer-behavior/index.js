const assert = require('node:assert/strict');
const { app, windowsAppInstaller } = require('deskgap');

app.on('window-all-closed', () => {});
app.once('ready', async () => {
    const timeout = setTimeout(() => app.exit(1), 15000);
    try {
        assert.equal(process.platform, 'win32');
        const supported = windowsAppInstaller.isSupported();
        assert.equal(supported, true);
        const identity = await windowsAppInstaller.getPackageIdentity();
        assert.equal(identity, null);
        await assert.rejects(
            windowsAppInstaller.checkForUpdates(),
            error => typeof error.code === 'string'
                && error.code.startsWith('HRESULT_0x')
                && Number.isInteger(error.hresult),
        );
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