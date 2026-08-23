const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-power-monitor-'));
const outputFile = path.join(outputDirectory, 'power-monitor.cjs');
buildSync({
    bundle: true,
    entryPoints: [path.resolve(__dirname, '../../js/node/power-monitor.ts')],
    format: 'cjs',
    outfile: outputFile,
    platform: 'node',
    target: 'node24',
});
global.__embedder_mod = {
    powerMonitorNative: {
        isOnBatteryPower: () => false,
        startMonitoring: () => {},
    },
};
const { PowerMonitor } = require(outputFile);

test.after(() => fs.rmSync(outputDirectory, { force: true, recursive: true }));

class PowerMonitorBackend {
    onBattery = false;

    isOnBatteryPower() {
        return this.onBattery;
    }

    startMonitoring(callbacks) {
        this.callbacks = callbacks;
    }
}

test('reports the current power source', () => {
    const backend = new PowerMonitorBackend();
    const powerMonitor = new PowerMonitor(backend);

    assert.equal(backend.callbacks, undefined);
    assert.equal(powerMonitor.onBatteryPower, false);
    assert.equal(powerMonitor.isOnBatteryPower(), false);
    backend.onBattery = true;
    assert.equal(powerMonitor.onBatteryPower, true);
    assert.equal(powerMonitor.isOnBatteryPower(), true);
});

test('emits suspend, resume, and power source events', () => {
    const backend = new PowerMonitorBackend();
    const powerMonitor = new PowerMonitor(backend);
    const events = [];
    for (const event of ['suspend', 'resume', 'on-ac', 'on-battery']) {
        powerMonitor.on(event, () => events.push(event));
    }
    const registeredCallbacks = backend.callbacks;
    powerMonitor.on('suspend', () => {});
    assert.equal(backend.callbacks, registeredCallbacks);

    backend.callbacks.onSuspend();
    backend.callbacks.onResume();
    backend.callbacks.onPowerSourceChanged(false);
    backend.callbacks.onPowerSourceChanged(true);

    assert.deepEqual(events, ['suspend', 'resume', 'on-ac', 'on-battery']);
});