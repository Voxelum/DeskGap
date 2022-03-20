const { app, BrowserWindow, dialog, Tray, Menu, systemPreferences } = require('deskgap');
const { join } = require('path');

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
        width: 800,
        height: 600,
        frame: false,
        // titleBarStyle: 'hidden',
        maximizable: false,
    }).once('ready-to-show', () => {
        for (const eventName of ['blur', 'focus']) {
            mainWindow.on(eventName, () => { 
                mainWindow.webView.getService('').send('windowEvent', eventName);
            })
        }

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

    mainWindow.webView.publishServices({
        "dialog": dialog,
        "browserWindow": mainWindow,
        "": {
            execute(code) {
                return (new Function('browserWindow', code))(mainWindow);
            }
        }
    });

    if (process.platform !== 'win32') {
        mainWindow.webView.setDevToolsEnabled(true);
    }

    mainWindow.loadFile("app.html");
});
