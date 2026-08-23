const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { shell } = require('deskgap');

describe('shell module', { skip: process.platform !== 'win32' }, () => {
    it('creates, updates, and replaces Windows shortcut links', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-shortcut-'));
        const shortcutPath = path.join(directory, 'test.lnk');
        const target = process.execPath;

        try {
            assert.equal(shell.writeShortcutLink(shortcutPath, {
                target,
                args: '--first',
                description: 'DeskGap shortcut test',
                cwd: directory,
                icon: target,
                iconIndex: 0,
            }), true);
            assert.equal(fs.existsSync(shortcutPath), true);
            assert.equal(shell.writeShortcutLink(shortcutPath, { target }), false);
            assert.equal(shell.writeShortcutLink(shortcutPath, 'update', { args: '--updated' }), true);
            assert.equal(shell.writeShortcutLink(shortcutPath, 'replace', { target }), true);
            assert.equal(shell.writeShortcutLink(shortcutPath, 'invalid', { target }), false);
        }
        finally {
            fs.rmSync(directory, { force: true, recursive: true });
        }
    });
});