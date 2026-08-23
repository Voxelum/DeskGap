const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-command-line-'));
const outputFile = path.join(outputDirectory, 'command-line.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/command-line.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
const { CommandLine } = require(outputFile);

const originalArgv = process.argv;
const originalWebView2Arguments = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
test.afterEach(() => {
    process.argv = originalArgv;
    if (originalWebView2Arguments == null) delete process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    else process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = originalWebView2Arguments;
});
test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

test('reads switches from process arguments', () => {
    process.argv = ['DeskGap', 'app.js', '--ozone-platform=wayland', '--disable-gpu'];
    const commandLine = new CommandLine();
    assert.equal(commandLine.hasSwitch('ozone-platform'), true);
    assert.equal(commandLine.getSwitchValue('ozone-platform'), 'wayland');
    assert.equal(commandLine.hasSwitch('disable-gpu'), true);
    assert.equal(commandLine.getSwitchValue('missing'), '');
});

test('appends and removes switches', () => {
    process.argv = ['DeskGap', 'app.js'];
    const commandLine = new CommandLine();
    commandLine.appendSwitch('proxy-server', 'http://localhost:8080');
    assert.equal(commandLine.hasSwitch('proxy-server'), true);
    assert.equal(commandLine.getSwitchValue('proxy-server'), 'http://localhost:8080');
    if (process.platform === 'win32') {
        assert.match(process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, /--proxy-server="http:\/\/localhost:8080"/);
    }
    commandLine.removeSwitch('proxy-server');
    assert.equal(commandLine.hasSwitch('proxy-server'), false);
});

test('rejects invalid switch names', () => {
    const commandLine = new CommandLine();
    assert.throws(() => commandLine.appendSwitch('bad switch'), /Invalid command-line switch/);
});
