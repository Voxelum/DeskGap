const {
    app,
    BrowserWindow,
    clipboard,
    dialog,
    Menu,
    nativeImage,
    nativeTheme,
    powerMonitor,
    screen,
    session,
    systemPreferences,
    Tray,
} = require('deskgap');
const assert = require('node:assert/strict');
const { join } = require('path');

async function runParitySmokeTests(mainWindow) {
    const tests = [];
    const run = async (name, operation) => {
        const startedAt = Date.now();
        if (process.argv.includes('--e2e')) console.log(`DESKGAP_E2E_TEST_START=${name}`);
        try {
            const details = await operation();
            tests.push({ name, status: 'passed', durationMs: Date.now() - startedAt, details });
        }
        catch (error) {
            tests.push({
                name,
                status: 'failed',
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    await run('app locale and Electron paths', () => {
        const systemLocale = app.getSystemLocale();
        const executable = app.getPath('exe');
        const logs = app.getPath('logs');
        assert.ok(systemLocale.length > 0);
        assert.ok(executable.length > 0);
        assert.ok(logs.length > 0);
        return { systemLocale, executable, logs };
    });

    await run('BrowserWindow and webContents lookup', () => {
        assert.equal(BrowserWindow.fromId(mainWindow.id), mainWindow);
        assert.equal(BrowserWindow.fromWebContents(mainWindow.webContents), mainWindow);
        assert.equal(mainWindow.isDestroyed(), false);
        const nativeHandle = mainWindow.getNativeWindowHandle();
        assert.ok(Buffer.isBuffer(nativeHandle));
        assert.ok(nativeHandle.length > 0);
        return {
            id: mainWindow.id,
            focused: mainWindow.isFocused(),
            nativeHandleBytes: nativeHandle.length,
            size: mainWindow.getSize(),
        };
    });

    await run('BrowserWindow mutable state', () => {
        const originalMaximizable = mainWindow.maximizable;
        const originalMinimizable = mainWindow.minimizable;
        try {
            mainWindow.hide();
            assert.equal(mainWindow.isVisible(), false);
            mainWindow.show();
            assert.equal(mainWindow.isVisible(), true);
            mainWindow.maximizable = !originalMaximizable;
            mainWindow.minimizable = !originalMinimizable;
            assert.equal(mainWindow.maximizable, !originalMaximizable);
            assert.equal(mainWindow.minimizable, !originalMinimizable);
            mainWindow.setAspectRatio(4 / 3);
            mainWindow.setAspectRatio(0);
            return {
                fullScreen: mainWindow.isFullScreen(),
                maximized: mainWindow.isMaximized(),
                minimized: mainWindow.isMinimized(),
                visible: mainWindow.isVisible(),
            };
        }
        finally {
            mainWindow.maximizable = originalMaximizable;
            mainWindow.minimizable = originalMinimizable;
            mainWindow.show();
        }
    });

    await run('BrowserWindow create and destroy lifecycle', () => {
        const probeWindow = new BrowserWindow({
            show: false,
            width: 320,
            height: 240,
            maximizable: false,
            minimizable: false,
        });
        try {
            assert.equal(probeWindow.isVisible(), false);
            probeWindow.show();
            assert.equal(probeWindow.isVisible(), true);
            probeWindow.minimize();
            assert.equal(probeWindow.isMinimized(), true);
            probeWindow.restore();
            assert.equal(probeWindow.isMinimized(), false);
            probeWindow.maximizable = true;
            probeWindow.maximize();
            assert.equal(probeWindow.isMaximized(), true);
            probeWindow.unmaximize();
            assert.equal(probeWindow.isMaximized(), false);
            return { id: probeWindow.id, size: probeWindow.getSize() };
        }
        finally {
            probeWindow.destroy();
            assert.equal(probeWindow.isDestroyed(), true);
        }
    });

    await run('screen display enumeration', () => {
        const displays = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();
        assert.ok(displays.length > 0);
        assert.ok(displays.some(display => display.id === primary.id));
        assert.ok(primary.scaleFactor > 0);
        return { count: displays.length, primary };
    });

    await run('nativeImage bitmap conversion', () => {
        const bitmap = Buffer.from([255, 64, 32, 255, 32, 128, 255, 255]);
        const image = nativeImage.createFromBitmap(bitmap, { width: 2, height: 1, scaleFactor: 1 });
        assert.deepEqual(image.getSize(), { width: 2, height: 1 });
        assert.deepEqual(image.toBitmap(), bitmap);
        const png = image.toPNG();
        assert.deepEqual(nativeImage.createFromBuffer(png).getSize(), { width: 2, height: 1 });
        return { pngBytes: png.length, size: image.getSize() };
    });

    await run('clipboard text round trip', () => {
        const originalText = clipboard.readText();
        const probe = `DeskGap parity probe ${Date.now()}`;
        try {
            clipboard.writeText(probe);
            assert.equal(clipboard.readText(), probe);
        }
        finally {
            clipboard.writeText(originalText);
        }
        return { restored: true };
    });

    await run('session protocol fetch and ownership', async () => {
        const ephemeral = session.createEphemeral();
        const persistent = session.fromPartition('persist:parity-sample');
        assert.equal(ephemeral.kind, 'ephemeral');
        assert.equal(persistent.kind, 'persistent');
        assert.equal(mainWindow.webContents.session, session.defaultSession);
        ephemeral.protocol.handle('parity', request => new Response(
            JSON.stringify({ method: request.method, pathname: new URL(request.url).pathname }),
            { headers: { 'content-type': 'application/json' } },
        ));
        const response = await ephemeral.fetch('parity://sample/round-trip');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { method: 'GET', pathname: '/round-trip' });
        return {
            defaultId: session.defaultSession.id,
            ephemeralId: ephemeral.id,
            persistentId: persistent.id,
        };
    });

    await run('theme, power, and preferences', () => {
        const darkMode = systemPreferences.isDarkMode();
        const shouldUseDarkColors = nativeTheme.shouldUseDarkColors;
        const onBatteryPower = powerMonitor.isOnBatteryPower();
        assert.equal(typeof darkMode, 'boolean');
        assert.equal(typeof shouldUseDarkColors, 'boolean');
        assert.equal(typeof onBatteryPower, 'boolean');
        return { darkMode, shouldUseDarkColors, onBatteryPower };
    });

    return {
        passed: tests.filter(test => test.status === 'passed').length,
        failed: tests.filter(test => test.status === 'failed').length,
        platform: process.platform,
        tests,
    };
}

const lock = app.requestSingleInstanceLock()

console.log(lock)
app.on('second-instance', (args, cwd) => {
    console.log(`second instance ${cwd}`)
    console.log(args)
})

const isDefaultClient = app.isDefaultProtocolClient('xmcl')

console.log(`locale: ${app.getLocale()}`)
console.log(`Dark theme: ${systemPreferences.isDarkMode()}`)

console.log(`protocol: ${isDefaultClient}`)
console.log(`set protocol: ${app.setAsDefaultProtocolClient('xmcl')}`)

app.once('ready', () => {
    const mainWindow = new BrowserWindow({
        show: false,
        width: 980,
        height: 720,
        // titleBarStyle: 'hidden',
    }).once('ready-to-show', () => {
        mainWindow.show();
    });

    const tray = new Tray(join(__dirname, './icon.ico'));

    const menu = Menu.buildFromTemplate([
        {
            type: 'normal',
            label: 'hello'
        }
    ]);

    tray.setContextMenu(menu);

    tray.setTooltip('hello world!')
    tray.on('click', () => {
        console.log('on clicked!')
    })
    tray.on('double-click', () => {
        console.log('on double clicked!')
    })

    mainWindow.webView.handle('demo.execute', (_context, code) => {
        return (new Function('browserWindow', code))(mainWindow);
    });
    mainWindow.webView.handle('demo.show-error-box', (_context, { title, content }) => {
        dialog.showErrorBox(title, content);
        return null;
    });
    mainWindow.webView.handle('demo.window', (_context, { method, args = [] }) => {
        const allowedMethods = new Set([
            'center',
            'flashFrame',
            'maximize',
            'minimize',
            'restore',
            'setFullScreen',
            'setPosition',
            'setSize',
            'setTitleBarStyle',
            'setVibrancies',
            'unmaximize',
        ]);
        if (!allowedMethods.has(method)) throw new Error(`Unsupported demo window method: ${method}`);
        return mainWindow[method](...args);
    });
    mainWindow.webView.handle('parity.run', async () => {
        const report = await runParitySmokeTests(mainWindow);
        if (process.argv.includes('--e2e')) {
            console.log(`DESKGAP_E2E_RESULT=${JSON.stringify(report)}`);
            setTimeout(() => {
                if (report.failed === 0) mainWindow.close();
                else app.exit(1);
            }, 100);
        }
        return report;
    });

    if (process.platform !== 'win32') {
        mainWindow.webView.setDevToolsEnabled(true);
    }

    mainWindow.loadFile("app.html");
});
