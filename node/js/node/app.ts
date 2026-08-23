import { Menu, MenuTypeCode } from './menu';
import defaultMenuTemplate from './internal/menu/default-template';
import appInfo from './internal/app-info'
import appPath from './internal/app-path'
import { embeddedAppIdentity } from './internal/app-identity';

import globals from './internal/globals';
import { EventEmitter, IEventMap } from './internal/events';
import { bulkUISync } from './internal/dispatch';

import path = require('path');
import { spawn } from 'child_process';
import { AppNative, appNative } from './internal/native';
import type { BrowserWindow } from './browser-window';
import { CommandLine } from './command-line';

export interface RelaunchOptions {
    args?: string[];
    execPath?: string;
}

export class Dock {
    /** @internal */ constructor(private readonly native_: AppNative) {}

    hide(): void {
        this.native_.setDockVisible(false);
    }

    show(): Promise<void> {
        if (!this.native_.setDockVisible(true)) return Promise.reject(new Error('Failed to show the application dock icon'));
        return Promise.resolve();
    }

    isVisible(): boolean {
        return this.native_.isDockVisible();
    }
}

const pathNameValues = {
    'appData': 0,
    'temp': 1,
    'desktop': 2,
    'documents': 3,
    'downloads': 4,
    'music': 5,
    'pictures': 6,
    'videos': 7,
    'home': 8,
    'userData': -1,
    'exe': -2,
    'logs': -3,
    'localData': -4,
    'sessionData': -5,
    'cache': -6,
};

export type PathName = keyof typeof pathNameValues;

export interface AppEvents extends IEventMap {
    /**
     * Emitted when DeskGap has finished initializing.
     */
    'ready': [],

    /**
     * Emitted when all windows have been closed.
     * 
     * If you do not subscribe to this event and all windows are closed, the default behavior is to quit the app;
     * however, if you subscribe, you control whether the app quits or not.
     * If the user pressed `Cmd + Q`, or the developer called `app.quit()`,
     * DeskGap will first try to close all the windows and then emit the `will-quit` event,
     * and in this case the `window-all-closed` event would not be emitted.
     */
    'window-all-closed': [],
    'will-quit': [],
    'before-quit': [],

    'second-instance': [string[], string],
    'browser-window-created': [BrowserWindow],
    'activate': [],
    'open-url': [string],
    /**
     * Emitted when the application is quitting.
     * @param 0 [[IEventObject]]
     * @param 1 The exit code
     */
    'quit': [number]

}

/** 
 * Control your application's event lifecycle.
 * 
 * Thread: Node
 */

export class App extends EventEmitter<AppEvents> {

    readonly commandLine = new CommandLine();
    readonly dock: Dock | undefined;

    /** @internal */ private isReady_ = false;
    /** @internal */ private triggersWindowAllClosed_ = true;
    /** @internal */ private whenReady_: Promise<void>;
    /** @internal */ private resolveWhenReady_: () => void;
    /** @internal */ private native_: AppNative;
    /** @internal */ private menu_: Menu | null = Menu.buildFromTemplate(defaultMenuTemplate);
    /** @internal */ private menuNativeId_: number | null = null;

    constructor() {
        super();

        this.native_ = appNative;
        this.dock = process.platform === 'darwin' ? new Dock(this.native_) : undefined;

        this.whenReady_ = new Promise((resolve) => {
            this.resolveWhenReady_ = resolve;
        });
    }

    /** @internal */
    private run_() {
        this.native_.run({
            onReady: () => {
                this.isReady_ = true;
                if (process.platform === 'darwin') {
                    this.actuallySetTheMenu_();
                }

                try {
                    this.trigger_('ready');
                }
                finally {
                    this.removeAllListeners('ready');
                    this.resolveWhenReady_();
                }
            },

            //The native land will prevent the quit triggered by user interaction and call this,
            //which actually exits the app by default and can be prevented by event handlers.
            beforeQuit: () => {
                this.quit();
            },
            onActivate: () => this.trigger_('activate'),
            onOpenURL: (url: string) => this.trigger_('open-url', null, url)
        });

        require(appPath);
    }

    /** @internal */
    private notifyWindowAllClosed_() {
        if (this.triggersWindowAllClosed_) {
            if (!this.trigger_('window-all-closed')) {
                this.quit();
            }
        }
    }

    /** @internal */
    private notifyBrowserWindowCreated_(browserWindow: BrowserWindow) {
        this.trigger_('browser-window-created', null, browserWindow);
    }

    getAppPath(): string {
        return appPath;
    }

    requestSingleInstanceLock() {
        return this.native_.requestSingleInstanceLock({
            onSecondInstance: (args: string, pwd: string) => {
                this.trigger_('second-instance', {}, args.split(' '), pwd);
            },
        });
    }

    getLocale() {
        return this.native_.getLocale();
    }

    getSystemLocale() {
        return this.native_.getLocale().split('.')[0].replace(/_/g, '-');
    }

    setAppUserModelId(id: string): void {
        this.native_.setAppUserModelId(id);
    }

    hasSingleInstanceLock() {
        return this.native_.hasSingleInstanceLock();
    }

    releaseSingleInstanceLock() {
        this.native_.releaseSingleInstanceLock();
    }

    isDefaultProtocolClient(protocol: string): boolean {
        return this.native_.isDefaultProtocolClient(protocol);
    }

    setAsDefaultProtocolClient(protocol: string): boolean {
        return this.native_.setAsDefaultProtocolClient(protocol);
    }

    quit() {
        this.trigger_('before-quit', {
            defaultAction: () => {
                this.triggersWindowAllClosed_ = false;
                try {
                    for (const browserWindow of globals.browserWindowsById.values()) {
                        browserWindow.close();
                        if (!browserWindow.isDestroyed()) {
                            return;
                        }
                    }
                    this.trigger_('will-quit', {
                        defaultAction: () => {
                            this.exit(0);
                        }
                    });
                }
                finally {
                    this.triggersWindowAllClosed_ = true;
                }
            }
        });
    }
    exit(code: number = 0): void {
        this.trigger_('quit', null, code);
        process.on('exit', () => {
            this.native_.exit(code);
        });
        process.exit(code);
    }

    relaunch(options: RelaunchOptions = {}): void {
        const executablePath = options.execPath == null
            ? this.native_.getExecutablePath()
            : path.resolve(options.execPath);
        const args = options.args == null ? process.argv.slice(1) : options.args.slice();
        process.once('exit', () => {
            const child = spawn(executablePath, args, {
                detached: true,
                env: process.env,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();
        });
    }

    whenReady(): Promise<void> {
        return this.whenReady_;
    }

    isReady(): boolean {
        return this.isReady_;
    }
    getName(): string {
        return appInfo.name;
    }
    setName(value: string): void {
        appInfo.name = value;
    }

    getVersion(): string | null {
        return appInfo.version;
    }
    setVersion(version: string): void {
        appInfo.version = version;
    }

    /** @internal */ private pathCache_ = new Map<PathName, string>();
    setPath(name: PathName, value: string): void {
        this.pathCache_.set(name, value);
    }
    getPath(name: PathName): string {
        let result = this.pathCache_.get(name);
        if (result == null) {
            if (name === 'userData') {
                result = path.join(this.getPath('appData'), embeddedAppIdentity.storageName);
            }
            else if (name === 'localData') {
                result = path.join(this.native_.getPath(9), embeddedAppIdentity.storageName);
            }
            else if (name === 'sessionData') {
                result = path.join(this.getPath('localData'), 'Sessions');
            }
            else if (name === 'cache') {
                result = path.join(
                    this.native_.getPath(10),
                    embeddedAppIdentity.storageName,
                    ...(process.platform === 'win32' ? ['Cache'] : []),
                );
            }
            else if (name === 'exe') {
                result = this.native_.getExecutablePath();
            }
            else if (name === 'logs') {
                result = path.join(this.getPath('localData'), 'Logs');
            }
            else {
                const pathNameValue = pathNameValues[name];
                if (pathNameValue == null) {
                    throw new TypeError(`Invalid path name: ${name}`);
                }
                result = this.native_.getPath(pathNameValue);
            }
            this.pathCache_.set(name, result as string);
        }
        return result as string;
    }

    setMenu(menu: Menu | null) {
        this.menu_ = menu;
        if (process.platform === 'darwin') {
            if (this.isReady_) {
                this.actuallySetTheMenu_();
            }
        }
        else {
            bulkUISync(() => {
                for (const browserWindow of globals.browserWindowsById.values()) {
                    browserWindow.setMenu(this.menu_);
                }
            });
        }
    }

    /** @internal */
    private actuallySetTheMenu_() {
        if (this.menu_ == null) return;
        bulkUISync(() => {
            const oldMenuNativeId = this.menuNativeId_;
            const oldMenu = this.menu_;

            if (this.menu_ == null) {
                this.native_.setMenu(null);
                this.menuNativeId_ = null;
            }
            else {
                const [menuNativeId, nativeMenu] = this.menu_['createNative_'](MenuTypeCode.main, null);
                this.native_.setMenu(nativeMenu);
                this.menuNativeId_ = menuNativeId;
            }

            if (oldMenuNativeId != null) {
                oldMenu!['destroyNative_'](oldMenuNativeId);
            }
        });
    }

    getMenu(): Menu | null {
        return this.menu_;
    }
}

const app = new App();

Menu.setApplicationMenu = (menu) => app.setMenu(menu);
Menu.getApplicationMenu = () => app.getMenu();

export { app };
