const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-native-theme-'));
const outputFile = path.join(outputDirectory, 'native-theme.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/native-theme.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { NativeTheme } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

class DarkModeSource extends EventEmitter {
    dark = false;
    source = 0;

    isDarkMode() {
        return this.dark;
    }

    toggle() {
        this.dark = !this.dark;
        this.emit('dark-mode-toggled');
    }

    getThemeSource() {
        return this.source;
    }

    setThemeSource(source) {
        this.source = source;
    }

    shouldUseDarkColors() {
        if (this.source === 2) return true;
        if (this.source === 1) return false;
        return this.dark;
    }
}

test('follows the system theme by default', () => {
    const source = new DarkModeSource();
    const nativeTheme = new NativeTheme(source, source);

    assert.equal(nativeTheme.themeSource, 'system');
    assert.equal(nativeTheme.shouldUseDarkColors, false);
    source.toggle();
    assert.equal(nativeTheme.shouldUseDarkColors, true);
});

test('overrides the system theme and emits updated', () => {
    const source = new DarkModeSource();
    const nativeTheme = new NativeTheme(source, source);
    let updates = 0;
    nativeTheme.on('updated', () => updates++);

    nativeTheme.themeSource = 'dark';
    assert.equal(nativeTheme.shouldUseDarkColors, true);
    source.toggle();
    assert.equal(nativeTheme.shouldUseDarkColors, true);
    assert.equal(updates, 1);

    nativeTheme.themeSource = 'system';
    source.toggle();
    assert.equal(updates, 3);
});

test('rejects an invalid theme source', () => {
    const source = new DarkModeSource();
    const nativeTheme = new NativeTheme(source, source);
    assert.throws(() => {
        nativeTheme.themeSource = 'automatic';
    }, /Invalid theme source/);
});