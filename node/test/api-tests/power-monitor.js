const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { powerMonitor } = require('deskgap');

describe('powerMonitor module', () => {
    it('reports whether the system is using battery power', () => {
        assert.equal(typeof powerMonitor.onBatteryPower, 'boolean');
        assert.equal(typeof powerMonitor.isOnBatteryPower(), 'boolean');
        assert.equal(typeof powerMonitor.on, 'function');
    });
});