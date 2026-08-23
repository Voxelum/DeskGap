import { BrowserWindow } from './browser-window';
import * as path from 'path';
import * as fs from 'fs';
import { dialogNative, NativeFileDialogCommonOptions, NativeFileOpenDialogOptions, NativeFileSaveDialogOptions, NativeMessageBoxOptions } from './internal/native';

export interface IFileFilter {
    name: string;
    extensions: string[];
}

export interface FileDialogCommonOptions {
    title: string | null;
    defaultPath: string | null;
    buttonLabel: string | null;
    filters: IFileFilter[];
    message: string | null;
}

export type FileOpenDialogProperty = keyof typeof FileOpenDialogPropertyEnum;

export interface FileOpenDialogOptions extends FileDialogCommonOptions {
    properties: FileOpenDialogProperty[]
}
export interface FileSaveDialogOptions extends FileDialogCommonOptions {
    nameFieldLabel: string | null;
    showsTagField: boolean | null;
}

export interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
}

export interface SaveDialogReturnValue {
    canceled: boolean;
    filePath: string;
}

export type MessageBoxType = 'none' | 'info' | 'error' | 'question' | 'warning';

export interface MessageBoxOptions {
    type: MessageBoxType;
    buttons: string[];
    defaultId: number;
    cancelId: number;
    title: string | null;
    message: string;
    detail: string | null;
    checkboxLabel: string | null;
    checkboxChecked: boolean;
}

export interface MessageBoxReturnValue {
    response: number;
    checkboxChecked: boolean;
}

const MessageBoxTypeCode: Record<MessageBoxType, number> = {
    none: 0,
    info: 1,
    error: 2,
    question: 3,
    warning: 4
};

const FileOpenDialogPropertyEnum = {
    openFile: 1 << 0,
    openDirectory: 1 << 1,
    multiSelections: 1 << 2,
    showHiddenFiles: 1 << 3,
    createDirectory: 1 << 4,
    promptToCreate: 1 << 5,
    noResolveAliases: 1 << 6,
    treatPackageAsDirectory: 1 << 7
};

const prepareCommonOptions = (options: Partial<FileDialogCommonOptions>): NativeFileDialogCommonOptions => {
    const result: NativeFileDialogCommonOptions = Object.assign({
        title: null,
        defaultPath: null,
        buttonLabel: null,
        filters: [],
        message: null,
        defaultDirectory: null,
        defaultFilename: null
    }, options);

    if (result.defaultPath != null) {
        let isDirectory = false;
        try {
            const pathInfo = fs.lstatSync(result.defaultPath);
            isDirectory = pathInfo.isDirectory();
        }
        catch (e) { }

        if (isDirectory) {
            result.defaultDirectory = result.defaultPath;
        }
        else {
            const pathDirname = path.dirname(result.defaultPath);
            result.defaultDirectory = pathDirname == '.' ? null : pathDirname;
            result.defaultFilename = path.basename(result.defaultPath);
        }
    }

    for (const filter of result.filters) {
        if (filter.extensions.includes('*')) {
            filter.extensions = [];
        }

        if (filter.extensions.length === 0) {
            filter.name += " (*.*)";
        }
        else {
            filter.name += ` (${filter.extensions.map(ex => `*.${ex}`).join(', ')})`;
        }
    }
    return result;
}

export class Dialog {
    static showErrorBox(title: string, content: string): void {
        dialogNative.showErrorBox(title, content);
    }

    static showMessageBox(browserWindow: BrowserWindow, options: Partial<MessageBoxOptions> & Pick<MessageBoxOptions, 'message'>): Promise<MessageBoxReturnValue>;
    static showMessageBox(options: Partial<MessageBoxOptions> & Pick<MessageBoxOptions, 'message'>): Promise<MessageBoxReturnValue>;
    static showMessageBox(
        browserWindowOrOptions: BrowserWindow | (Partial<MessageBoxOptions> & Pick<MessageBoxOptions, 'message'>),
        maybeOptions?: Partial<MessageBoxOptions> & Pick<MessageBoxOptions, 'message'>
    ): Promise<MessageBoxReturnValue> {
        const browserWindow = browserWindowOrOptions instanceof BrowserWindow ? browserWindowOrOptions : null;
        const options = (browserWindow == null ? browserWindowOrOptions : maybeOptions) as Partial<MessageBoxOptions> & Pick<MessageBoxOptions, 'message'>;
        const buttons = options.buttons == null || options.buttons.length === 0 ? ['OK'] : options.buttons.slice();
        const defaultId = options.defaultId != null && options.defaultId >= 0 && options.defaultId < buttons.length ? options.defaultId : 0;
        const cancelId = options.cancelId != null && options.cancelId >= 0 && options.cancelId < buttons.length ? options.cancelId : -1;
        const type = options.type || 'none';
        if (!(type in MessageBoxTypeCode)) {
            throw new TypeError(`Invalid message box type: ${type}`);
        }

        const nativeOptions: NativeMessageBoxOptions = {
            type: MessageBoxTypeCode[type],
            buttons,
            defaultId,
            cancelId,
            title: options.title || null,
            message: options.message,
            detail: options.detail || null,
            checkboxLabel: options.checkboxLabel || null,
            checkboxChecked: options.checkboxChecked || false
        };

        return new Promise((resolve) => {
            dialogNative.showMessageBox(browserWindow != null ? browserWindow["native_"] : null, nativeOptions, (response, checkboxChecked) => {
                resolve({ response, checkboxChecked });
            });
        });
    }

    static showOpenDialog(browserWindow: BrowserWindow, options: Partial<FileOpenDialogOptions>): Promise<OpenDialogReturnValue>;
    static showOpenDialog(options: Partial<FileOpenDialogOptions>): Promise<OpenDialogReturnValue>;
    static showOpenDialog(browserWindow: BrowserWindow, options: Partial<FileOpenDialogOptions>, callback: (filePaths: string[] | null) => void): void;
    static showOpenDialog(
        browserWindowOrOptions: BrowserWindow | Partial<FileOpenDialogOptions>,
        optionsOrCallback?: Partial<FileOpenDialogOptions> | ((filePaths: string[] | null) => void),
        callback?: (filePaths: string[] | null) => void
    ): void | Promise<OpenDialogReturnValue> {
        const browserWindow = browserWindowOrOptions instanceof BrowserWindow ? browserWindowOrOptions : null;
        const options = (browserWindow == null ? browserWindowOrOptions : optionsOrCallback) as Partial<FileOpenDialogOptions>;
        const legacyCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

        if (legacyCallback == null) {
            return new Promise((resolve) => {
                Dialog.showOpenDialogNative_(browserWindow, options, (filePaths) => resolve({
                    canceled: filePaths == null,
                    filePaths: filePaths || []
                }));
            });
        }

        Dialog.showOpenDialogNative_(browserWindow, options, legacyCallback);
    }

    private static showOpenDialogNative_(browserWindow: BrowserWindow | null, options: Partial<FileOpenDialogOptions>, callback: (filePaths: string[] | null) => void): void {
        let propertyBits = 0;
        for (const property of options.properties || []) {
            if (property in FileOpenDialogPropertyEnum) {
                propertyBits |= FileOpenDialogPropertyEnum[property];
            }
            else {
                throw new TypeError(`Invalid property for file open dialog: ${property}`);
            }
        }

        if (!(propertyBits & FileOpenDialogPropertyEnum.openDirectory)) {
            propertyBits |= FileOpenDialogPropertyEnum.openFile;
        }

        const commonOptions = prepareCommonOptions(options);

        const nativeOptions: NativeFileOpenDialogOptions = {
            commonOptions,
            propertyBits
        };

        dialogNative.showOpenDialog(browserWindow != null ? browserWindow["native_"] : null, nativeOptions, callback);
    }

    static showOpenDialogAsync(browserWindow: BrowserWindow, options: Partial<FileOpenDialogOptions>): Promise<OpenDialogReturnValue> {
        return Dialog.showOpenDialog(browserWindow, options);
    }

    static showSaveDialog(browserWindow: BrowserWindow, options: Partial<FileSaveDialogOptions>): Promise<SaveDialogReturnValue>;
    static showSaveDialog(options: Partial<FileSaveDialogOptions>): Promise<SaveDialogReturnValue>;
    static showSaveDialog(browserWindow: BrowserWindow, options: Partial<FileSaveDialogOptions>, callback: (filePath: string | null) => void): void;
    static showSaveDialog(
        browserWindowOrOptions: BrowserWindow | Partial<FileSaveDialogOptions>,
        optionsOrCallback?: Partial<FileSaveDialogOptions> | ((filePath: string | null) => void),
        callback?: (filePath: string | null) => void
    ): void | Promise<SaveDialogReturnValue> {
        const browserWindow = browserWindowOrOptions instanceof BrowserWindow ? browserWindowOrOptions : null;
        const options = (browserWindow == null ? browserWindowOrOptions : optionsOrCallback) as Partial<FileSaveDialogOptions>;
        const legacyCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

        if (legacyCallback == null) {
            return new Promise((resolve) => {
                Dialog.showSaveDialogNative_(browserWindow, options, (filePath) => resolve({
                    canceled: filePath == null,
                    filePath: filePath || ''
                }));
            });
        }

        Dialog.showSaveDialogNative_(browserWindow, options, legacyCallback);
    }

    private static showSaveDialogNative_(browserWindow: BrowserWindow | null, options: Partial<FileSaveDialogOptions>, callback: (filePath: string | null) => void): void {
        const commonOptions = prepareCommonOptions(options);

        const nativeOptions: NativeFileSaveDialogOptions = Object.assign({
            nameFieldLabel: null,
            showsTagField: null,
        }, options, { commonOptions });

        dialogNative.showSaveDialog(browserWindow != null ? browserWindow["native_"] : null, nativeOptions, callback);
    }

    static showSaveDialogAsync(browserWindow: BrowserWindow, options: Partial<FileSaveDialogOptions>): Promise<SaveDialogReturnValue> {
        return Dialog.showSaveDialog(browserWindow, options);
    }
}
