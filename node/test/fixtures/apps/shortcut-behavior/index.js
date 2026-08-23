const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, shell } = require('deskgap');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-shortcut-'));
const desktop = path.join(root, 'Desktop');
const appData = path.join(root, 'AppData');
app.setPath('desktop', desktop);
app.setPath('appData', appData);

app.on('window-all-closed', () => {});
app.once('ready', () => {
    try {
        assert.equal(shell.createDesktopShortcut('DeskGap Test', { args: '--shortcut-test' }), true);
        assert.equal(shell.createStartMenuShortcut('DeskGap Test', { description: 'DeskGap shortcut fixture' }), true);
        assert.equal(fs.existsSync(path.join(desktop, 'DeskGap Test.lnk')), true);
        assert.equal(fs.existsSync(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'DeskGap Test.lnk')), true);
        process.stdout.write('ok');
        fs.rmSync(root, { force: true, recursive: true });
        app.exit();
    }
    catch (error) {
        fs.rmSync(root, { force: true, recursive: true });
        process.stderr.write(`${error.stack}\n`);
        app.exit(1);
    }
});