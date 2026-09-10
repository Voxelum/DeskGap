const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, describe } = require('node:test');
const { app, webViews } = require('deskgap');

const testDir = path.join(__dirname, 'api-tests');

const testFiles = fs.readdirSync(testDir)
    .filter(filename => filename.endsWith('.js'))
    .map(filename => path.join(testDir, filename));

// Individual suites may destroy their last window before the next suite starts.
app.on('window-all-closed', () => {});
app.on('before-quit', event => event.preventDefault());

const watchdog = setTimeout(() => {
    console.error('Native API tests timed out before completing.');
    app.exit(1);
}, 180000);

app.whenReady().then(async () => {
    console.log(`Native API environment: ${JSON.stringify({
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        os: os.release(),
        deskgap: process.versions.deskgap,
        node: process.versions.node,
        v8: process.versions.v8,
        defaultEngine: webViews.getDefaultEngine(),
        availableEngines: ['webview2', 'winrt'].filter(engine => webViews.isEngineAvailable(engine)),
    })}`);
    const counts = { tests: 0, passed: 0, failed: 0, skipped: 0 };
    const tests = run({
        files: [],
        isolation: 'none',
        concurrency: false,
        setup() {
            describe('Native API tests', { timeout: 150000 }, () => {
                for (const file of testFiles) require(file);
            });
        },
    });

    for await (const { type, data } of tests) {
        if (type === 'test:diagnostic') console.log(data.message);
        if (type !== 'test:pass' && type !== 'test:fail') continue;
        const passed = type === 'test:pass';
        console.log(`${data.skip ? 'SKIP' : passed ? 'PASS' : 'FAIL'} ${data.name}`);
        if (!passed) console.error(data.details.error);
        if (data.details.type === 'test') {
            counts.tests++;
            if (data.skip) counts.skipped++;
            else if (passed) counts.passed++;
            else counts.failed++;
        }

        // The in-process Node runner ends its stream only at beforeExit, but DeskGap's
        // native loop and transport remain alive. The enclosing suite is our boundary.
        if (data.nesting !== 0) continue;
        const success = passed && counts.tests > 0 && counts.failed === 0 && !process.exitCode;
        console.log(`Native API results: ${JSON.stringify(counts)}`);
        await Promise.all([process.stdout, process.stderr].map(stream => new Promise((resolve, reject) => {
            stream.write('', error => error ? reject(error) : resolve());
        })));
        if (process.env.DESKGAP_TEST_RESULT) {
            fs.writeFileSync(process.env.DESKGAP_TEST_RESULT, JSON.stringify({ success }));
        }
        clearTimeout(watchdog);
        app.exit(success ? 0 : 1);
        return;
    }
    throw new Error('Native API test stream ended before its enclosing suite completed.');
}).catch(error => {
    console.error(error);
    app.exit(1);
});
