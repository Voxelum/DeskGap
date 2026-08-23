import { shellNative } from './internal/native';
import { mkdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

export type ShortcutOperation = 'create' | 'update' | 'replace';

export interface ShortcutDetails {
    target?: string;
    cwd?: string;
    args?: string;
    description?: string;
    icon?: string;
    iconIndex?: number;
    appUserModelId?: string;
    toastActivatorClsid?: string;
}

function writeShortcutLink(shortcutPath: string, options: ShortcutDetails): boolean;
function writeShortcutLink(shortcutPath: string, operation: ShortcutOperation, options: ShortcutDetails): boolean;
function writeShortcutLink(
    shortcutPath: string,
    operationOrOptions: ShortcutOperation | ShortcutDetails,
    maybeOptions?: ShortcutDetails,
): boolean {
    const operation = typeof operationOrOptions === 'string' ? operationOrOptions : 'create';
    const options = typeof operationOrOptions === 'string' ? maybeOptions : operationOrOptions;
    if (options == null || !['create', 'update', 'replace'].includes(operation)) {
        return false;
    }
    return shellNative.writeShortcutLink(resolve(shortcutPath), operation, {
        target: options.target == null ? null : resolve(options.target),
        cwd: options.cwd == null ? null : resolve(options.cwd),
        args: options.args || null,
        description: options.description || null,
        icon: options.icon == null ? null : resolve(options.icon),
        iconIndex: options.iconIndex || 0,
        appUserModelId: options.appUserModelId || null,
        toastActivatorClsid: options.toastActivatorClsid || null,
    });
}

function shortcutFileName(name: string): string {
    if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..' || basename(name) !== name) {
        throw new TypeError('Shortcut name must be a non-empty file name');
    }
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) {
        throw new TypeError('Shortcut name contains invalid characters');
    }
    const stem = name.replace(/\.lnk$/i, '').split('.')[0];
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
        throw new TypeError('Shortcut name is reserved by Windows');
    }
    return name.toLowerCase().endsWith('.lnk') ? name : `${name}.lnk`;
}

function createShortcutIn(directory: string, name: string, details: ShortcutDetails): boolean {
    if (process.platform !== 'win32') return false;
    const { app } = require('./app') as typeof import('./app');
    const target = resolve(details.target || app.getPath('exe'));
    mkdirSync(directory, { recursive: true });
    return writeShortcutLink(join(directory, shortcutFileName(name)), 'replace', {
        ...details,
        target,
        cwd: details.cwd == null ? dirname(target) : details.cwd,
    });
}

export const shell = {
    openExternal: (url: string): boolean => shellNative.openExternal(url),
    openPath: (path: string): Promise<string> => Promise.resolve(shellNative.openPath(resolve(path))),
    showItemInFolder: (path: string) => shellNative.showItemInFolder(resolve(path)),
    writeShortcutLink,
    createDesktopShortcut(name: string, details: ShortcutDetails = {}): boolean {
        const { app } = require('./app') as typeof import('./app');
        return createShortcutIn(app.getPath('desktop'), name, details);
    },
    createStartMenuShortcut(name: string, details: ShortcutDetails = {}): boolean {
        const { app } = require('./app') as typeof import('./app');
        return createShortcutIn(join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), name, details);
    },
};
