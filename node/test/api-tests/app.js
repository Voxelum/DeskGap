const { app } = require('deskgap');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { spawnDeskGapAppAsync } = require('../utils');
const fs = require('fs');
const path = require('path');

describe('process', () => {
    describe('process.argv', () => {
        it('returns an array containing the command line arguments passed to the app', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app } = require('deskgap');
                process.stdout.write(process.argv[2] + process.argv[3]);
                app.exit();
            `, 'hello', '你好');
            assert.equal(result.stdout, 'hello你好');
        });
    });
    describe('process.versions.deskgap', () => {
        it('returns the version of DeskGap', () => {
            const versionFromSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'VERSION'), 'utf8');
            assert.equal(process.versions.deskgap, versionFromSource);
        })
    });
});

describe('app module', () => {
    describe('app.getVersion', () => {
        it('returns the version field of package.json', () => {
            assert.equal(app.getVersion(), '0.0.1')
        })
    });
    describe('app.setVersion(version)', () => {
        it('overrides the version', () => {
            assert.equal(app.getVersion(), '0.0.1')
            app.setVersion('test-version')

            assert.equal(app.getVersion(), 'test-version')
            app.setVersion('0.0.1')
        })
    });

    describe('app.getName()', () => {
        it('returns the name field of package.json if productName does not exists', () => {
            assert.equal(app.getName(), 'DeskGap Test');
        });
        it('returns the productName field of package.json if both name and productName exists', async () => {
            const spawnResult = await spawnDeskGapAppAsync('app-with-product-name');
            assert.equal(spawnResult.stdout, 'package.productName');
        });
    });

    describe('locale and paths', () => {
        it('provides the system locale and Electron executable/log path names', () => {
            assert.equal(typeof app.getSystemLocale(), 'string');
            assert.equal(app.getSystemLocale().length > 0, true);
            assert.equal(path.isAbsolute(app.getPath('exe')), true);
            assert.equal(app.getPath('logs'), path.join(app.getPath('userData'), 'logs'));
            assert.doesNotThrow(() => app.setAppUserModelId('com.deskgap.test'));
        });
    });

    describe('browser-window-created event', () => {
        it('emits after the window is registered', () => {
            let createdWindow;
            app.once('browser-window-created', (_, browserWindow) => {
                createdWindow = browserWindow;
                assert.equal(BrowserWindow.fromId(browserWindow.id), browserWindow);
            });
            const browserWindow = new BrowserWindow({ show: false });
            try {
                assert.equal(createdWindow, browserWindow);
            }
            finally {
                browserWindow.destroy();
            }
        });
    });

    describe('app.relaunch()', () => {
        it('starts a replacement process after exit', async () => {
            const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deskgap-relaunch-'));
            const markerPath = path.join(directory, 'relaunched');
            const code = `
                const { app } = require('deskgap');
                const fs = require('fs');
                if (process.argv[2] === '--relaunched') {
                    fs.writeFileSync(process.argv[3], 'ok');
                    app.exit();
                } else {
                    app.once('ready', () => {
                        app.relaunch({ args: [process.argv[1], '--relaunched', ${JSON.stringify(markerPath)}] });
                        app.exit();
                    });
                }
            `;

            try {
                await spawnDeskGapAppAsync('arbitrary-code', code);
                const deadline = Date.now() + 5000;
                while (!fs.existsSync(markerPath) && Date.now() < deadline) {
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                assert.equal(fs.readFileSync(markerPath, 'utf8'), 'ok');
            }
            finally {
                fs.rmSync(directory, { force: true, recursive: true });
            }
        });
    });

    describe('app.setName(name)', () => {
        it('overrides the name', () => {
            assert.equal(app.getName(), 'DeskGap Test')
            app.setName('test-name')
        
            assert.equal(app.getName(), 'test-name')
            app.setName('DeskGap Test')
        })
    });

    describe('app.exit(code)', () => {
        it('emits a process exit event with the code', async () => {
            const error = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app } = require('deskgap');
                app.on('ready', () => {
                    app.exit(123);
                });
                process.on('exit', code => {
                    process.stdout.write('Exit event with code: ' + code);
                });
            `).catch(e => e);
            assert.ok(error instanceof Error);
            assert.equal(error.result.code, 123);
            assert.equal(error.result.stdout, 'Exit event with code: 123');
        });

        it('emits a quit event but the before-quit and will-quit events will not be emitted', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app } = require('deskgap');
                app.on('quit', () => process.stdout.write('quit'));
                app.on('before-quit', () => process.stdout.write('before-quit'));
                app.on('will-quit', () => process.stdout.write('will-quit'));
                app.on('ready', () => {
                    app.exit();
                });
            `);
            assert.equal(result.stdout, 'quit');
        });

        it('closes all windows without asking', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];

                const createWindow = () => {
                    const window = new BrowserWindow({ show: false });
                    window.on('close', (e) => {
                        process.stdout.write('Please do not close');
                    });
                    windows.push(window);
                };

                app.once('ready', () => {
                    for (let i = 1; i <= 5; i++) {
                        createWindow()
                    }
                    app.exit();
                });
            `);
            assert.equal(result.stdout, "");
        });
    });

    describe('app.whenReady', () => {
        it('returns a Promise', () => {
          assert.ok(app.whenReady() instanceof Promise);
        });
    
                it('becomes fulfilled if the app is already ready', async () => {
                    assert.equal(app.isReady(), true);
                    await app.whenReady();
        });
    });

    describe('window-all-closed event', () => {
        it('not having any subscriber will cause the app quitting when all window closed', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    windows.push(new BrowserWindow({ show: false}));
                    windows.push(new BrowserWindow({ show: false}));
                    windows.forEach(w => w.close());
                    process.stdout.write('after all window closed');
                });
            `);
            assert.equal(result.stdout, '');
        });
        it('prevents app to be closed automatically when all windows closed if there is any subscriber', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    windows.push(new BrowserWindow({ show: false}));
                    windows.push(new BrowserWindow({ show: false}));
                    app.once('window-all-closed', () => {
                        process.stdout.write('emitted');
                    });
                    windows.forEach(w => w.close());
                    process.stdout.write(' prevented');
                    new BrowserWindow({ show: false }).close();
                    process.stdout.write('quitted');
                });
            `);
            assert.equal(result.stdout, 'emitted prevented');
        });
    });

    describe('app.quit()', () => {
        it('emits a before-quit event, windows’ close events, a will-quit event and a quit event', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    app.once('before-quit', () => process.stdout.write('0'));
                    for (let i = 1; i <= 2; i++) {
                        const window = new BrowserWindow({ show: false });
                        window.on('close', () => process.stdout.write(i.toString()));
                    }
                    app.once('will-quit', () => process.stdout.write('3'));
                    app.once('quit', () => process.stdout.write('4'));

                    app.quit();
                });
            `);
            assert.equal(result.stdout, "01234");
        })

        it('does not try to close windows if prevented in before-quit', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    app.once('before-quit', (e) => {
                        process.stdout.write('preventing close,');
                        e.preventDefault();
                    });
                    windows.push(new BrowserWindow({ show: false }).on('close', (e) => {
                        process.stdout.write('closing window');
                    }));
                    app.quit();
                    app.quit();
                });
            `);
            assert.equal(result.stdout, 'preventing close,closing window');
        });

        it('does not quit the app if prevented by one of windows', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    windows.push(new BrowserWindow({ show: false }));
                    windows.push(new BrowserWindow({ show: false }).once('close', (e) => {
                        process.stdout.write('preventing close');
                        e.preventDefault();
                    }));
                    app.quit();
                    app.quit();
                });
            `);
            assert.equal(result.stdout, 'preventing close');
        });

        it('closes all windows but not quit the app if prevented in will-quit', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                const windows = [];
                app.once('ready', () => {
                    windows.push(new BrowserWindow({ show: false }).once('close', (e) => {
                        process.stdout.write('closing window,');
                    }));
                    app.once('will-quit', e => {
                        process.stdout.write('preventing close');
                        e.preventDefault();
                    });
                    app.quit();
                    app.quit();
                });
            `);
            assert.equal(result.stdout, 'closing window,preventing close');
        });

        it('cannot be prevented in quit events', async () => {
            const result = await spawnDeskGapAppAsync('arbitrary-code', `
                const { app, BrowserWindow } = require('deskgap');
                app.once('ready', () => {
                    app.on('quit', e => {
                        e.preventDefault();
                    });
                    app.quit();
                });
            `);
            assert.equal(result.stdout, '');
        });
    });
});
