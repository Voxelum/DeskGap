const assert = require('node:assert/strict')
const { app, BrowserWindow, Menu } = require('deskgap')

app.once('ready', () => {
    let window
    try {
        const menu = Menu.buildFromTemplate([{ label: 'File', submenu: [{ label: 'Close' }] }])
        if (process.platform === 'darwin') {
            assert.throws(
                () => new BrowserWindow({ autoHideMenuBar: true, menu, show: false }),
                /supported only on Windows and Linux/,
            )
            process.stdout.write('ok')
            app.exit()
            return
        }
        window = new BrowserWindow({
            autoHideMenuBar: true,
            menu,
            show: false,
        })
        assert.equal(window.isMenuBarAutoHide(), true)
        assert.equal(window.isMenuBarVisible(), false)
        window.setMenuBarVisibility(true)
        assert.equal(window.isMenuBarVisible(), true)
        window.setAutoHideMenuBar(false)
        assert.equal(window.isMenuBarAutoHide(), false)
        assert.equal(window.isMenuBarVisible(), true)
        process.stdout.write('ok')
        window.destroy()
        app.exit()
    }
    catch (error) {
        process.stderr.write(`${error.stack}\n`)
        if (window != null && !window.isDestroyed()) window.destroy()
        app.exit(1)
    }
})