const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-menu-'));
const outputFile = path.join(outputDirectory, 'menu.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/menu.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});

const nativeMenuItems = [];
class MenuItemNative {
    constructor(role, type, submenu, onClick) {
        Object.assign(this, { role, type, submenu, onClick });
        nativeMenuItems.push(this);
    }
    setAccelerator(tokens) { this.accelerator = tokens; }
    setChecked(checked) { this.checked = checked; }
    setEnabled(enabled) { this.enabled = enabled; }
    setLabel(label) { this.label = label; }
    destroy() { this.destroyed = true; }
}

class MenuNative {
    constructor(type) {
        this.type = type;
        this.items = [];
    }
    append(item) { this.items.push(item); }
    destroy() { this.destroyed = true; }
}

global.__embedder_mod = {
    MenuItemNative,
    MenuNative,
    commitUISync() {},
    delayUISync() {},
};
process.resourcesPath = path.resolve(__dirname, '../fixtures/apps');
const { Menu, MenuItem, MenuTypeCode } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));
test.beforeEach(() => nativeMenuItems.length = 0);

test('applies roles, state, accelerators, and recursive id lookup', () => {
    const menu = Menu.buildFromTemplate([{
        id: 'edit',
        role: 'editMenu',
    }, {
        id: 'view',
        label: 'View',
        submenu: [{ id: 'reload', role: 'reload' }],
    }]);

    assert.equal(menu.items[0].label, 'Edit');
    assert.equal(menu.items[0].type, 'submenu');
    assert.equal(menu.getMenuItemById('reload').label, 'Reload');
    assert.equal(menu.getMenuItemById('missing'), null);

    const reload = menu.getMenuItemById('reload');
    reload.enabled = false;
    reload.checked = true;
    reload.label = 'Refresh';

    const [, native] = menu.createNative_(MenuTypeCode.context, null);
    const nativeReload = native.items[1].submenu.items[0];
    assert.equal(nativeReload.role, 'reload');
    assert.equal(nativeReload.enabled, false);
    assert.equal(nativeReload.checked, true);
    assert.equal(nativeReload.label, 'Refresh');
    assert.deepEqual(nativeReload.accelerator, [process.platform === 'darwin' ? 'cmd' : 'ctrl', 'r']);
});

test('enforces one owner for menu items and submenus', () => {
    const firstMenu = new Menu();
    const secondMenu = new Menu();
    const item = new MenuItem({ label: 'Owned' });
    firstMenu.append(item);
    assert.throws(() => secondMenu.append(item), /already attached/);
    assert.throws(() => firstMenu.append({}), /requires a MenuItem/);

    const submenu = Menu.buildFromTemplate([{ label: 'Child' }]);
    new MenuItem({ label: 'First parent', submenu });
    assert.throws(() => new MenuItem({ label: 'Second parent', submenu }), /already attached as a submenu/);
    assert.throws(() => new MenuItem({ label: 'Invalid parent', submenu: new Menu(), type: 'normal' }), /must have type/);
});

test('maintains one checked radio item in each separator-delimited group', () => {
    const menu = Menu.buildFromTemplate([
        { id: 'one', label: 'One', type: 'radio' },
        { id: 'two', label: 'Two', type: 'radio' },
        { type: 'separator' },
        { id: 'three', label: 'Three', type: 'radio', checked: true },
        { id: 'four', label: 'Four', type: 'radio', checked: false },
    ]);

    assert.equal(menu.getMenuItemById('one').checked, true);
    assert.equal(menu.getMenuItemById('two').checked, false);
    assert.equal(menu.getMenuItemById('three').checked, true);
    assert.equal(menu.getMenuItemById('four').checked, false);

    menu.getMenuItemById('two').checked = true;
    assert.equal(menu.getMenuItemById('one').checked, false);
    assert.equal(menu.getMenuItemById('two').checked, true);

    menu.createNative_(MenuTypeCode.context, null);
    nativeMenuItems.find(item => item.label === 'One').onClick();
    assert.equal(menu.getMenuItemById('one').checked, true);
    assert.equal(menu.getMenuItemById('two').checked, false);
});

test('validates popup options and cleans up before invoking its callback', () => {
    const menu = Menu.buildFromTemplate([{ label: 'Context item' }]);
    assert.throws(() => menu.popup({ window: {}, x: 10 }), /both x and y/);
    assert.throws(() => menu.popup(), /No window specified/);

    let onClose;
    let callbackObservedDestroyed = false;
    const window = {
        native_: {
            popupMenu(native, location, positioningItem, close) {
                assert.deepEqual(location, [10, 20]);
                assert.equal(positioningItem, 0);
                onClose = () => {
                    close();
                    callbackObservedDestroyed = native.destroyed === true;
                };
            },
        },
    };
    menu.popup({ window, x: 10, y: 20, positioningItem: 0, callback() {} });
    onClose();
    assert.equal(callbackObservedDestroyed, true);
});