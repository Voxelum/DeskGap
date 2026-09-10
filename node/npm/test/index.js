const { app } = require('deskgap');
const assert = require('assert');
const fs = require('fs');

app.once('ready', () => {
	console.log('index.js: DeskGap app ready.');
	const versionFile = process.env['DESKGAP_NPM_TEST_VERSION_FILE'];
	assert.ok(versionFile, 'DESKGAP_NPM_TEST_VERSION_FILE is required');
	assert.strictEqual(fs.readFileSync(versionFile, 'utf8').trim(), process.versions.deskgap)
	app.exit();
});
