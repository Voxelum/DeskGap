const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const executable = process.env.DESKGAP_NATIVE_TEST_EXE;
test('native Authenticode validates the full trusted subject, signed bytes, certificate suffix and file locks', {
    skip: !executable ? 'Set DESKGAP_NATIVE_TEST_EXE to the rebuilt DeskGap executable' : false,
    timeout: 180000,
}, () => {
    const env = {
        ...process.env,
        DESKGAP_ENTRY: path.resolve(__dirname, '../fixtures/apps/windows-executable-behavior'),
    };
    if (process.platform === 'win32' && !env.DESKGAP_SIGNED_TEST_EXE) {
        env.DESKGAP_SIGNED_TEST_EXE = process.execPath;
        // This only discovers the fixture's expected name; the native call must independently establish trust.
        const signature = spawnSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            '[System.Security.Cryptography.X509Certificates.X509Certificate2]::new([System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($env:DESKGAP_SIGNED_TEST_EXE)).Subject',
        ], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
        assert.equal(signature.status, 0, signature.stderr);
        env.DESKGAP_SIGNED_TEST_PUBLISHER = signature.stdout.trim();
        assert.ok(env.DESKGAP_SIGNED_TEST_PUBLISHER, 'The Node test runner must have an embedded trusted signature');
    }
    const result = spawnSync(path.resolve(executable), [], {
        env, encoding: 'utf8', windowsHide: true, timeout: 150000,
    });
    if (result.pid > 0) {
        fs.rmSync(path.join(env.DESKGAP_ENTRY, `.verify-${result.pid}`), { recursive: true, force: true });
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /ok/);
});
