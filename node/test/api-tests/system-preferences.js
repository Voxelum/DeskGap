const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { systemPreferences } = require('deskgap');

describe('systemPreferences permissions', () => {
    it('queries platform media and accessibility permissions', async () => {
        assert.equal(typeof await systemPreferences.askForMediaAccess('microphone'), 'boolean');
        assert.equal(typeof systemPreferences.isTrustedAccessibilityClient(false), 'boolean');
        await assert.rejects(systemPreferences.askForMediaAccess('location'), /Unsupported media type/);
    });
});