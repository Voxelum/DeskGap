import { app, Updater, windowsExecutable } from 'deskgap';
import assert = require('assert');
import fs = require('fs');

async function checkUpdaterTypes(updater: InstanceType<typeof Updater>, signal: AbortSignal) {
	updater.on('download-progress', (_event, progress) => {
		const percent: number = progress.percent;
		assert.ok(percent >= 0);
	});
	const update = await updater.checkForUpdates('https://github.com/example/app/releases/download/v1.0.0/update.json', {
		allowPrerelease: true,
		signal,
	});
	if (update) {
		const downloaded = await updater.downloadUpdate(update, { signal });
		await updater.install(downloaded, { args: [], quit: false });
	}
}

async function checkWindowsExecutableTypes(filePath: string) {
	const publisherNames = ['CN=Example Publisher, O=Example Publisher, C=US'];
	if (!windowsExecutable.isSupported()) return;
	await windowsExecutable.verifySignature(filePath, publisherNames);
	await windowsExecutable.install(filePath, {
		publisherNames,
		args: [`--deskgap-wait-for-pid=${process.pid}`],
		quit: false,
	});
}

app.once('ready', () => {
	console.log('index-ts.ts: DeskGap app ready.');
	const versionFile = process.env['DESKGAP_NPM_TEST_VERSION_FILE'];
	assert.ok(versionFile, 'DESKGAP_NPM_TEST_VERSION_FILE is required');
	assert.strictEqual(fs.readFileSync(versionFile, 'utf8').trim(), process.versions.deskgap)
	app.exit();
});
