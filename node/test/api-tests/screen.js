const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { screen } = require('deskgap');

describe('screen module', () => {
    it('enumerates displays and identifies the primary display', () => {
        const displays = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();
        assert.equal(displays.length > 0, true);
        assert.equal(displays.some(display => display.id === primary.id), true);
        assert.equal(primary.size.width, primary.bounds.width);
        assert.equal(primary.size.height, primary.bounds.height);
        assert.equal(primary.workAreaSize.width, primary.workArea.width);
        assert.equal(primary.scaleFactor > 0, true);
        assert.equal(typeof primary.label, 'string');
    });
});