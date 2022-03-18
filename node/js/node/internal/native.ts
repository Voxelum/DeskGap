import type { FileDialogCommonOptions } from '../dialog'
import * as bindings from './bindings'

/**
 * node\src\node_bindings\app\app_wrap.cc
 */
export interface AppNative {
    run(listeners: {
        onReady(): void;
        beforeQuit(): void;
    }): void

    isDefaultProtocolClient(protocol: string): boolean
    setAsDefaultProtocolClient(protocol: string): boolean
    requestSingleInstanceLock(listeners: {
        onSecondInstance(args: string, cwd: string): void;
    }): boolean

    hasSingleInstanceLock(): boolean
    releaseSingleInstanceLock(): void
    exit(code: number): void
    getPath(name: number): string
    getResourcePath(): string
    setMenu(menu: MenuNative | null): string
    getArgv(): string[]
}

//@ts-expect-error
export declare class MenuItemNative {
    setEnabled(enabled: boolean): void;
    setLabel(label: string): void;
    setChecked(checked: boolean): void;
    setAccelerator(acceleratorTokens: string[]): void;
    destroy(): void;
    constructor(role: string, typeCode: number, submenu: MenuNative | null, onClick: () => void);
}

//@ts-expect-error
export declare class MenuNative {
    append(item: MenuItemNative): void;
    destroy(): void;
    constructor(typeCode: number, callbacks: {});
}

//@ts-expect-error
export declare class TrayNative {
    setTitle(title: string): void
    setIcon(iconPath: string): void
    setTooltip(tooltip: string): void
    destroy(): void
    popupMenu(menu: MenuNative, onClose: () => void): void

    constructor(iconPath: string, callbacks: {
        onClick(): void
        onDoubleClick(): void
        onRightClick(): void
    })
}

/**
 * node\src\node_bindings\webview\webview_wrap.cc
 */
//@ts-expect-error
export declare class WebViewNative {
    constructor(
        callbacks: {
            didFinishLoad: () => void,
            onStringMessage: (stringMessage: string) => void,
            onPageTitleUpdated: (title: string) => void,
        },
        engine: number | null,
    )

    loadLocalFile(path: string): void
    loadRequest(method: string, url: string, headers: Array<[string, string]>, body?: string): void
    setDevToolsEnabled(enabled: boolean): void
    executeJavaScript(script: string, callback: ((error: string) => void) | null): void
    reload(): void
    destroy(): void

    static isWinRTEngineAvailable(): boolean
    static getWebview2Version(): string
}

/**
 * node\src\node_bindings\window\browser_window_wrap.cc
 */
//@ts-expect-error
export declare class BrowserWindowNative {
    constructor(webview: WebViewNative,
        callbacks: {
            onBlur(): void
            onFocus(): void
            onResize(): void
            onMove(): void
            onClose(): void
        })
    setMaximizable(value: boolean): void
    setMinimizable(value: boolean): void
    setResizable(value: boolean): void
    setHasFrame(value: boolean): void
    setClosable(value: boolean): void

    center(): void
    setPosition(x: number, y: number, animate: boolean): void
    getPosition(): [number, number]

    setSize(w: number, h: number, animate: boolean): void
    setMaximumSize(w: number, h: number): void
    setMinimumSize(w: number, h: number): void
    getSize(): [number, number]
    minimize(): void

    setTitle(title: string): void
    setIcon(iconPath: string | null): void
    setMenu(menu: MenuNative | null): void
    setTitleBarStyle(style: number): void
    setVibrancies(vibrancies: Array<readonly [string, string, string, Array<readonly [string, number, boolean]>]>): void

    show(): void
    destroy(): void
}

export interface NativeFileDialogCommonOptions extends FileDialogCommonOptions {
    defaultDirectory: string | null;
    defaultFilename: string | null;
}

export interface NativeFileOpenDialogOptions {
    commonOptions: NativeFileDialogCommonOptions;
    propertyBits: number;
}

export interface NativeFileSaveDialogOptions {
    commonOptions: NativeFileDialogCommonOptions;
    nameFieldLabel: string | null;
    showsTagField: boolean | null;
}


export interface DialogNative {
    showErrorBox(title: string, content: string): void
    showOpenDialog(browserWindow: BrowserWindowNative | null, options: NativeFileOpenDialogOptions, callback: (filePaths: string[] | null) => void): void
    showSaveDialog(browserWindow: BrowserWindowNative | null, options: NativeFileSaveDialogOptions, callback: (filePaths: string | null) => void): void
}

/**
 * node\src\node_bindings\shell\shell_wrap.cc
 */
export interface ShellNative {
    openExternal(url: string): boolean
    showItemInFolder(path: string): void
}

export interface SystemPreferencesNative {
    getUserDefaultInteger(key: string): number
    getUserDefaultFloat(key: string): number
    getUserDefaultDouble(key: string): number
    getUserDefaultString(key: string): string
    getUserDefaultURL(key: string): string
    getUserDefaultBool(key: string): boolean
    getUserDefaultArrayJSON(key: string): object
    getUserDefaultDictionaryJSON(key: string): Array<any>

    getAndWatchDarkMode(watcher: () => void): boolean
}

//@ts-expect-error
export const MenuItemNative = bindings.MenuItemNative
//@ts-expect-error
export const MenuNative = bindings.MenuNative
//@ts-expect-error
export const TrayNative = bindings.TrayNative
export const appNative: AppNative = bindings.appNative
export const shellNative: ShellNative = bindings.shellNative
export const dialogNative: DialogNative = bindings.dialogNative
//@ts-expect-error
export const WebViewNative: WebViewNative = bindings.WebViewNative
//@ts-expect-error
export const BrowserWindowNative: BrowserWindowNative = bindings.BrowserWindowNative
export const systemPreferencesNative: SystemPreferencesNative = bindings.systemPreferencesNative
export const setNativeExceptionConstructor: (execptionClass: any) => void = bindings.setNativeExceptionConstructor
