const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const bootstrap = process.env.DESKGAP_BOOTSTRAP_TEST_EXE;

test('native handoff waits for the old process, strips its PID flag, and preserves the newest verified bundle', {
    skip: process.platform !== 'win32' || !bootstrap ? 'Set DESKGAP_BOOTSTRAP_TEST_EXE to the rebuilt Windows bootstrap' : false,
    timeout: 180000,
}, async t => {
    const id = `DeskGap-Persistence-${randomUUID()}`;
    const directory = path.join(__dirname, `.${id}`);
    const programRoot = path.join(process.env.LOCALAPPDATA, 'Programs', id);
    const applicationRoot = path.join(programRoot, 'application');
    const children = [];
    function start(file, args, options) {
        const child = spawn(file, args, options);
        const closed = once(child, 'close');
        children.push({ child, closed });
        return { child, closed };
    }
    t.after(async () => {
        for (const { child } of children.slice().reverse()) {
            if (child.exitCode === null && child.signalCode === null) child.kill();
        }
        await Promise.all(children.map(({ closed }) => closed.catch(() => {})));
        fs.rmSync(directory, { force: true, recursive: true });
        fs.rmSync(programRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
    });
    const runtime = path.join(directory, 'runtime');
    const application = path.join(directory, 'application');
    fs.mkdirSync(runtime, { recursive: true });
    fs.mkdirSync(application, { recursive: true });
    // Node is a standalone PE runtime; its script records which immutable runtime native actually launched.
    fs.copyFileSync(process.execPath, path.join(runtime, 'DeskGap.exe'));
    fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify({ name: id, version: '1.0.0', main: 'main.js' }));
    fs.writeFileSync(path.join(application, 'main.js'), '// app');

    function packageBundle(version) {
        const output = path.join(directory, `${version}.exe`);
        const packaged = spawnSync(process.execPath, [
            path.resolve(__dirname, '../../scripts/package-click-to-run.mjs'),
            path.resolve(bootstrap), runtime, application, output, version,
        ], { encoding: 'utf8', timeout: 60000, windowsHide: true });
        assert.equal(packaged.status, 0, packaged.stderr);
        const metadata = JSON.parse(packaged.stdout);
        return {
            output,
            runtime: path.join(programRoot, 'runtime', metadata.runtime.sha256),
            payload: path.join(applicationRoot, 'payloads', metadata.application.sha256),
            record: path.join(applicationRoot, 'bundles', `${metadata.runtime.sha256}.bundle`),
            marker: path.join(applicationRoot, 'bundles', `${metadata.runtime.sha256}.json`),
        };
    }

    async function launch(bundle, expected, waitForPid, whileWaiting) {
        const result = path.join(directory, `launched-${randomUUID()}.json`);
        const script = 'require("fs").writeFileSync(process.argv[1], JSON.stringify({executable:process.execPath,args:process.argv.slice(2)}))';
        const args = ['-e', script, result, 'argument with spaces', 'last'];
        if (waitForPid !== undefined) args.splice(4, 0, `--deskgap-wait-for-pid=${waitForPid}`);
        const { child, closed } = start(bundle.output, args, {
            timeout: 30000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        if (whileWaiting) await whileWaiting(child, result);
        const [status] = await closed;
        assert.equal(status, 0, stderr || 'Bootstrap failed');
        for (let attempt = 0; attempt < 200 && !fs.existsSync(result); attempt++) await delay(25);
        assert.ok(fs.existsSync(result), 'The selected runtime did not launch');
        await delay(25);
        const launched = JSON.parse(fs.readFileSync(result, 'utf8'));
        assert.equal(launched.executable.toLowerCase(), path.join(expected.runtime, 'DeskGap.exe').toLowerCase());
        assert.deepEqual(launched.args, ['argument with spaces', 'last']);
    }

    const original = packageBundle('1.0.0-beta.2');
    const prerelease = packageBundle('1.0.0-beta.10');
    const release = packageBundle('1.0.0');
    const { child: previous, closed: previousClosed } = start(process.execPath, ['-e', 'process.send("ready"); process.on("message", () => process.exit(0))'], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await once(previous, 'message');
    await launch(original, original, previous.pid, async (waiting, result) => {
        await delay(1000);
        assert.equal(waiting.exitCode, null, 'Bootstrap exited instead of waiting for the previous process');
        assert.equal(previous.exitCode, null);
        assert.ok(!fs.existsSync(programRoot), 'Installation started while the previous process was still alive');
        assert.ok(!fs.existsSync(result), 'The new application launched before the previous process exited');
        previous.send('exit');
        assert.equal((await previousClosed)[0], 0);
    });
    // Opening an already-exited PID may report ERROR_INVALID_PARAMETER; that is not a handoff failure.
    await launch(original, original, previous.pid);
    assert.ok(fs.existsSync(original.marker));
    assert.ok(!fs.existsSync(path.join(applicationRoot, 'active.json')), 'Native must not activate its embedded app');

    // These are certificate-layout regression fixtures, NOT signed/trusted executables.
    // Production still requires a SignPath-signed CTR test after assembling its complete payload.
    const unsigned = fs.readFileSync(original.output);
    const stubSize = fs.statSync(path.resolve(bootstrap)).size;
    const certificate = Buffer.alloc(16);
    certificate.writeUInt32LE(certificate.length, 0);
    certificate.writeUInt16LE(0x200, 4);
    certificate.writeUInt16LE(2, 6);
    for (let leading = 0; leading < 8; leading++) {
        const content = Buffer.concat([unsigned.subarray(0, stubSize), Buffer.alloc(leading), unsigned.subarray(stubSize)]);
        const padding = Buffer.alloc((8 - content.length % 8) % 8);
        const certificateOffset = content.length + padding.length;
        const withCertificate = Buffer.concat([content, padding, certificate]);
        const optional = withCertificate.readUInt32LE(0x3c) + 24;
        const securityDirectory = optional + (withCertificate.readUInt16LE(optional) === 0x20b ? 112 : 96) + 32;
        withCertificate.writeUInt32LE(certificateOffset, securityDirectory);
        withCertificate.writeUInt32LE(certificate.length, securityDirectory + 4);
        const output = path.join(directory, `certificate-layout-${leading}.exe`);
        fs.writeFileSync(output, withCertificate);
        await launch({ ...original, output }, original);
        fs.unlinkSync(output);
    }

    const activation = JSON.stringify({ sha256: 'a'.repeat(64), version: '1.1.0', requiredRuntimeApi: 1 });
    const activePath = path.join(applicationRoot, 'active.json');
    fs.writeFileSync(activePath, activation);
    await launch(original, original);
    await launch(prerelease, prerelease);
    await launch(original, prerelease);
    await launch(release, release);
    await launch(original, release, previous.pid);
    assert.equal(fs.readFileSync(activePath, 'utf8'), activation);

    const prereleaseRecord = fs.readFileSync(prerelease.record, 'utf8');
    const releaseRecord = fs.readFileSync(release.record, 'utf8');
    fs.writeFileSync(prerelease.record, prereleaseRecord.replace('1.0.0-beta.10', '99.0.0-beta.01'));
    fs.writeFileSync(release.record, releaseRecord.replace(path.basename(release.runtime), 'f'.repeat(64)));
    await launch(original, original);

    fs.writeFileSync(prerelease.record, prereleaseRecord);
    await launch(original, prerelease);
    fs.appendFileSync(path.join(prerelease.runtime, 'resources', 'app-identity.json'), 'corrupt');
    await launch(original, original);
    await launch(release, release);
    await launch(original, release);
    fs.unlinkSync(path.join(release.payload, 'main.js'));
    await launch(original, original);
    assert.equal(fs.readFileSync(activePath, 'utf8'), activation);
});
