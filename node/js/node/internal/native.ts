import type { FileDialogCommonOptions } from '../dialog'
import type { NativeSessionOptions } from '../session'
import * as bindings from './bindings'

export interface WindowsPackageIdentityNative {
    appInstallerUri: string | null;
    familyName: string;
    fullName: string;
    name: string;
    publisherId: string;
    version: string;
}

export interface WindowsAppInstallerNative {
    isSupported(): boolean;
    getPackageIdentity(): Promise<WindowsPackageIdentityNative | null>;
    checkForUpdates(): Promise<number>;
    install(uri: string, options: number, onProgress: (state: number, percent: number) => void): {
        promise: Promise<void>;
        cancel(): void;
    };
}

export const windowsAppInstallerNative = bindings.windowsAppInstallerNative as WindowsAppInstallerNative | undefined;

export interface ExternalWindowNative {
    isSupported(): boolean;
    moveAndResize(processId: number, x: number, y: number, width: number, height: number, timeout: number, dip: boolean): {
        cancel(): void;
        promise: Promise<void>;
    };
}

export const externalWindowNative = bindings.externalWindowNative as ExternalWindowNative;

/**
 * node\src\node_bindings\app\app_wrap.cc
 */
export interface AppNative {
    run(listeners: {
        onReady(): void;
        beforeQuit(): void;
        onActivate(): void;
        onOpenURL(url: string): void;
    }): void

    isDefaultProtocolClient(protocol: string): boolean
    setAsDefaultProtocolClient(protocol: string): boolean
    requestSingleInstanceLock(listeners: {
        onSecondInstance(args: string, cwd: string): void;
    }): boolean

    getLocale(): string
    getExecutablePath(): string
    setAppUserModelId(id: string): void
    setDockVisible(visible: boolean): boolean
    isDockVisible(): boolean
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
    setIcon(image: NativeImageNative): void
    setTooltip(tooltip: string): void
    destroy(): void
    popupMenu(menu: MenuNative, onClose: () => void): void

    constructor(image: NativeImageNative, callbacks: {
        onClick(): void
        onDoubleClick(): void
        onRightClick(): void
    })
}

//@ts-expect-error
export declare class NativeImageNative {
    constructor(sourceType?: number, data?: string | Buffer, widthOrScaleFactor?: number, height?: number, scaleFactor?: number)
    addRepresentation(buffer: Buffer, width?: number, height?: number, scaleFactor?: number): void
    crop(rectangle: { x: number; y: number; width: number; height: number }): NativeImageNative
    getAspectRatio(scaleFactor?: number): number
    getBitmap(scaleFactor?: number): Buffer
    getScaleFactors(): number[]
    getSize(scaleFactor?: number): { width: number; height: number }
    isEmpty(): boolean
    resize(width?: number, height?: number): NativeImageNative
    toJPEG(quality: number): Buffer
    toPNG(scaleFactor?: number): Buffer
}

//@ts-expect-error
export declare class NotificationNative {
    constructor(options: {
        title: string;
        body: string;
        iconPng: Buffer;
        silent: boolean;
    }, callbacks: {
        onShow(): void;
        onClick(): void;
        onClose(): void;
        onFailed(error: string): void;
    })
    show(): void
    close(): void
    static isSupported(): boolean
}

/**
 * node\src\node_bindings\webview\webview_wrap.cc
 */
//@ts-expect-error
export declare class WebViewNative {
    constructor(
        callbacks: {
            didFinishLoad: () => void,
            didStartNavigation: (url: string, isRedirect: boolean) => void,
            didFailLoad: (errorCode: number, errorDescription: string, validatedURL: string) => void,
            onNavigationPolicyRequest: (requestId: number, url: string, isRedirect: boolean) => void,
            onNewWindowRequested: (url: string, frameName: string, features: string) => void,
            onRenderProcessGone: (reason: string, exitCode: number) => void,
            onConsoleMessage: (level: string, message: string) => void,
            onPageTitleUpdated: (title: string) => void,
            onFilesDropped: (paths: string[]) => void,
            onCustomProtocolRequest: (
                requestId: number,
                method: string,
                url: string,
                headers: Array<[string, string]>,
            ) => void,
            onCustomProtocolRequestCancelled: (requestId: number) => void,
        },
        engine: number | null,
        session: NativeSessionOptions,
        backgroundColor: number | null,
    )

    loadLocalFile(path: string, fragment: string, applicationHost: string): void
    loadRequest(method: string, url: string, headers: Array<[string, string]>, body?: string): void
    setDevToolsEnabled(enabled: boolean): void
    trySuspend(callback: (suspended: boolean) => void): void
    resume(): void
    executeJavaScript(script: string, callback: ((error: string) => void) | null): void
    reload(): void
    resolveNavigationPolicy(requestId: number, allow: boolean): void
    resolveCustomProtocolRequest(
        requestId: number,
        statusCode: number,
        statusText: string,
        headers: Array<[string, string]>,
        body: Buffer,
    ): void
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
            onMaximize(): void
            onUnmaximize(): void
            onMinimize(): void
            onRestore(): void
            onEnterFullScreen(): void
            onLeaveFullScreen(): void
        })
    setMaximizable(value: boolean): void
    setMinimizable(value: boolean): void
    setResizable(value: boolean): void
    setHasFrame(value: boolean): void
    setClosable(value: boolean): void
    setTransparent(transparent: boolean): void
    setHasShadow(hasShadow: boolean): void
    setParent(parent: BrowserWindowNative | null): void
    setModal(modal: boolean): void

    center(): void
    setPosition(x: number, y: number, animate: boolean): void
    getPosition(): [number, number]

    setSize(w: number, h: number, animate: boolean): void
    setContentSize(w: number, h: number, animate: boolean): void
    setMaximumSize(w: number, h: number): void
    setMinimumSize(w: number, h: number): void
    setAspectRatio(ratio: number, extraWidth: number, extraHeight: number): void
    getNativeWindowHandle(): Buffer
    getSize(): [number, number]
    getContentSize(): [number, number]
    minimize(): void
    restore(): void
    maximize(): void
    unmaximize(): void
    hide(): void
    focus(): void
    isVisible(): boolean
    isFocused(): boolean
    isMinimized(): boolean
    isMaximized(): boolean
    setFullScreen(fullScreen: boolean): void
    isFullScreen(): boolean
    flashFrame(flash: boolean): void

    setTitle(title: string): void
    setIcon(iconPath: string | null): void
    setMenu(menu: MenuNative | null): void
    setAutoHideMenuBar(autoHide: boolean): void
    isMenuBarAutoHide(): boolean
    setMenuBarVisibility(visible: boolean): void
    isMenuBarVisible(): boolean
    popupMenu(menu: MenuNative, location: [number, number] | null, positioningItem: number, onClose: () => void): void
    setTitleBarStyle(style: number): void
    setTrafficLightPosition(x: number, y: number): void
    setBackgroundMaterial(material: number): void
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

export interface NativeMessageBoxOptions {
    type: number;
    buttons: string[];
    defaultId: number;
    cancelId: number;
    title: string | null;
    message: string;
    detail: string | null;
    checkboxLabel: string | null;
    checkboxChecked: boolean;
}


export interface DialogNative {
    showErrorBox(title: string, content: string): void
    showOpenDialog(browserWindow: BrowserWindowNative | null, options: NativeFileOpenDialogOptions, callback: (filePaths: string[] | null) => void): void
    showSaveDialog(browserWindow: BrowserWindowNative | null, options: NativeFileSaveDialogOptions, callback: (filePaths: string | null) => void): void
    showMessageBox(browserWindow: BrowserWindowNative | null, options: NativeMessageBoxOptions, callback: (response: number, checkboxChecked: boolean) => void): void
}

/**
 * node\src\node_bindings\shell\shell_wrap.cc
 */
export interface ShellNative {
    openExternal(url: string): boolean
    openPath(path: string): string
    showItemInFolder(path: string): void
    writeShortcutLink(path: string, operation: string, details: NativeShortcutDetails): boolean
}

export interface NativeShortcutDetails {
    target: string | null
    cwd: string | null
    args: string | null
    description: string | null
    icon: string | null
    iconIndex: number
    appUserModelId: string | null
    toastActivatorClsid: string | null
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
    getThemeSource(): number
    setThemeSource(source: number): void
    shouldUseDarkColors(): boolean
    askForMediaAccess(mediaType: string, callback: (granted: boolean) => void): void
    isTrustedAccessibilityClient(prompt: boolean): boolean
}

export interface ScreenNativeDisplay {
    id: number
    label: string
    bounds: { x: number; y: number; width: number; height: number }
    workArea: { x: number; y: number; width: number; height: number }
    scaleFactor: number
    primary: boolean
}

export interface ScreenNative {
    getAllDisplays(): ScreenNativeDisplay[]
}

export interface ClipboardNative {
    readText(): string
    writeText(text: string): boolean
    writeImage(png: Buffer): boolean
}

export interface PowerMonitorNative {
    isOnBatteryPower(): boolean
    startMonitoring(callbacks: {
        onSuspend(): void
        onResume(): void
        onPowerSourceChanged(onBattery: boolean): void
    }): void
}

export interface CredentialsNative {
    getPassword(service: string, account: string): Promise<string | null>
    setPassword(service: string, account: string, password: string): Promise<void>
    deletePassword(service: string, account: string): Promise<boolean>
    findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

//@ts-expect-error
export const MenuItemNative = bindings.MenuItemNative
//@ts-expect-error
export const MenuNative = bindings.MenuNative
//@ts-expect-error
export const TrayNative = bindings.TrayNative
//@ts-expect-error
export const NativeImageNative = bindings.NativeImageNative
//@ts-expect-error
export const NotificationNative = bindings.NotificationNative
export const appNative: AppNative = bindings.appNative
export const shellNative: ShellNative = bindings.shellNative
export const screenNative: ScreenNative = bindings.screenNative
export const clipboardNative: ClipboardNative = bindings.clipboardNative
export const powerMonitorNative: PowerMonitorNative = bindings.powerMonitorNative
export const credentialsNative: CredentialsNative = bindings.credentialsNative
export const dialogNative: DialogNative = bindings.dialogNative
//@ts-expect-error
export const WebViewNative: WebViewNative = bindings.WebViewNative
//@ts-expect-error
export const BrowserWindowNative: BrowserWindowNative = bindings.BrowserWindowNative
export const systemPreferencesNative: SystemPreferencesNative = bindings.systemPreferencesNative
export const setNativeExceptionConstructor: (execptionClass: any) => void = bindings.setNativeExceptionConstructor
