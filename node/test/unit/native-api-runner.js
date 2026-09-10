const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(__dirname, '.native-api-runner-'));
const apiTests = path.join(directory, 'api-tests');
const runner = path.resolve(__dirname, '../index.js');
const launcher = path.resolve(__dirname, '../start.js');
const bootstrap = path.join(directory, 'bootstrap.cjs');
fs.mkdirSync(apiTests);
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function execute(source, bootstrapSource) {
    fs.writeFileSync(path.join(apiTests, 'sample.js'), source);
    fs.writeFileSync(bootstrap, bootstrapSource);
    return spawnSync(process.execPath, [bootstrap], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, NODE_TEST_CONTEXT: '', DESKGAP_TEST_RESULT: path.join(directory, 'result.json') },
    });
}

const runnerBootstrap = `
    const fs = require('node:fs');
    const Module = require('node:module');
    const { EventEmitter } = require('node:events');
    const app = new EventEmitter();
    app.ready = false;
    app.whenReady = () => new Promise(resolve => setTimeout(() => { app.ready = true; resolve(); }, 20));
    app.exit = code => process.exit(code);
    app.closeWindow = () => { if (!app.emit('window-all-closed')) app.exit(0); };
    app.quit = () => {
        let prevented = false;
        app.emit('before-quit', { preventDefault() { prevented = true; } });
        if (!prevented) app.exit(0);
    };
    const load = Module._load;
    Module._load = function(name, ...args) {
        return name === 'deskgap' ? {
            app,
            webViews: { getDefaultEngine: () => null, isEngineAvailable: () => false },
        } : load.call(this, name, ...args);
    };
    const body = require('node:vm').runInThisContext(Module.wrap(fs.readFileSync(${JSON.stringify(runner)}, 'utf8')));
    body(exports, require, module, ${JSON.stringify(runner)}, __dirname);
`;

test('native runner waits for readiness and finishes after the last window closes', () => {
    const result = execute(`
        const { it } = require('node:test');
        const assert = require('node:assert/strict');
        const { app } = require('deskgap');
        it('first', () => { assert.equal(app.ready, true); app.closeWindow(); app.quit(); });
        it('last', () => assert.equal(app.ready, true));
    `, runnerBootstrap);
    assert.equal(result.error, undefined, result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS last/);
    assert.match(result.stdout, /"tests":2/);
    const environment = result.stdout.split('\n').find(line => line.startsWith('Native API environment: '));
    assert.ok(environment);
    const diagnostics = JSON.parse(environment.slice('Native API environment: '.length));
    assert.equal(diagnostics.node, process.versions.node);
    assert.equal(diagnostics.platform, process.platform);
    assert.equal(typeof diagnostics.pid, 'number');
    assert.deepEqual(diagnostics.availableEngines, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'result.json'))), { success: true });
});

test('native runner finishes remaining tests and propagates assertion failures', () => {
    const result = execute(`
        const { it } = require('node:test');
        it('fails', () => { throw new Error('intentional assertion failure'); });
        it('still runs', () => {});
    `, runnerBootstrap);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /intentional assertion failure/);
    assert.match(result.stdout, /PASS still runs/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'result.json'))), { success: false });
});

test('native runner reports timed out tests as failures', () => {
    const result = execute(`
        const { it } = require('node:test');
        it('hangs', { timeout: 25 }, () => new Promise(() => {}));
        it('still runs', () => {});
    `, runnerBootstrap);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /testTimeoutFailure/);
    assert.match(result.stdout, /PASS still runs/);
});

test('native runner rejects an empty test run', () => {
    const result = execute('', runnerBootstrap);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
});

test('native runner propagates suite registration and hook failures', () => {
    for (const source of [
        `throw new Error('registration failure');`,
        `const { before, it } = require('node:test');
         before(() => { throw new Error('hook failure'); });
         it('must not pass', () => {});`,
    ]) {
        const result = execute(source, runnerBootstrap);
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stdout, /FAIL Native API tests/);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'result.json'))), { success: false });
    }
});

test('native runner watchdog exits if the application never becomes ready', () => {
    const result = execute('', runnerBootstrap.replace(
        'const body =',
        `app.whenReady = () => new Promise(() => {});
         const setTimeout = global.setTimeout;
         global.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 180000 ? 25 : delay, ...args);
         const body =`,
    ));
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /timed out before completing/);
});

for (const completion of ['missing', 'failed', 'passed']) {
    test(`launcher validates ${completion} completion even when the runtime exits zero`, () => {
        const result = execute('', `
            const fs = require('node:fs');
            const Module = require('node:module');
            const { EventEmitter } = require('node:events');
            const load = Module._load;
            let resultPath;
            Module._load = function(name, ...args) {
                if (name !== '../npm/run') return load.call(this, name, ...args);
                return () => {
                    const child = new EventEmitter();
                    resultPath = process.env.DESKGAP_TEST_RESULT;
                    process.nextTick(() => {
                        if (${JSON.stringify(completion)} !== 'missing') {
                            fs.writeFileSync(resultPath, JSON.stringify({ success: ${completion === 'passed'} }));
                        }
                        child.emit('close', 0);
                    });
                    return child;
                };
            };
            process.argv[2] = __dirname;
            require(${JSON.stringify(launcher)});
            process.on('exit', () => {
                if (fs.existsSync(resultPath)) throw new Error('Completion file was not cleaned up');
            });
        `);
        assert.ifError(result.error);
        assert.equal(result.status, completion === 'passed' ? 0 : 1, result.stdout + result.stderr);
    });
}

test('launcher returns failure when the runtime cannot be spawned', () => {
    const result = spawnSync(process.execPath, [launcher, path.join(directory, 'missing-dist')], {
        encoding: 'utf8',
        timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /ENOENT/);
});

test('launcher kills its timed out runtime and returns failure', () => {
    const result = execute('', `
        const Module = require('node:module');
        const { EventEmitter } = require('node:events');
        const load = Module._load;
        Module._load = function(name, ...args) {
            if (name !== '../npm/run') return load.call(this, name, ...args);
            return () => {
                const child = new EventEmitter();
                child.kill = () => child.emit('close', null, 'SIGTERM');
                return child;
            };
        };
        const setTimeout = global.setTimeout;
        global.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 240000 ? 25 : delay, ...args);
        process.argv[2] = __dirname;
        require(${JSON.stringify(launcher)});
    `);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Native API test process timed out/);
});
