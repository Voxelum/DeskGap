const runDeskGap = require('../npm/run');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const distPath = process.argv[2];

if (distPath == null) {
    console.error("Missing [deskgap-dist-path] [args...]");
    console.error('Usage: node start.js [deskgap-dist-path] [args...]');
    process.exit(1);
}
else {
    const resultPath = path.join(__dirname, `.api-test-result-${randomUUID()}.json`);
    const previousResultPath = process.env.DESKGAP_TEST_RESULT;
    process.env.DESKGAP_TEST_RESULT = resultPath;
    const child = runDeskGap(distPath, __dirname, process.argv.slice(3));
    if (previousResultPath == null) delete process.env.DESKGAP_TEST_RESULT;
    else process.env.DESKGAP_TEST_RESULT = previousResultPath;

    let timedOut = false;
    const watchdog = setTimeout(() => {
        timedOut = true;
        console.error('Native API test process timed out.');
        child.kill();
    }, 240000);

    child.once('close', code => {
        clearTimeout(watchdog);
        let success = false;
        try {
            success = JSON.parse(fs.readFileSync(resultPath, 'utf8')).success === true;
        }
        catch (error) {
            console.error('Cannot read native API test completion:', error);
        }
        finally {
            fs.rmSync(resultPath, { force: true });
        }
        if (timedOut || code !== 0 || !success) {
            if (!success) console.error('Native API tests did not report successful completion.');
            process.exitCode = 1;
        }
    });
}
