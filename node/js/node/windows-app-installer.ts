import { windowsAppInstallerNative as native } from './internal/native';

export type WindowsAppInstallerUpdateAvailability =
    | 'unknown'
    | 'no-updates'
    | 'available'
    | 'required'
    | 'error';

export type WindowsAppInstallerProgressState = 'queued' | 'processing';

export interface WindowsPackageIdentity {
    appInstallerUri: string | null;
    familyName: string;
    fullName: string;
    name: string;
    publisherId: string;
    version: string;
}

export interface WindowsAppInstallerInstallProgress {
    percent: number;
    state: WindowsAppInstallerProgressState;
}

export interface WindowsAppInstallerInstallOptions {
    forceTargetApplicationShutdown?: boolean;
    installAllResources?: boolean;
    limitToExistingPackages?: boolean;
    onProgress?: (progress: WindowsAppInstallerInstallProgress) => void;
    requiredContentGroupOnly?: boolean;
    signal?: AbortSignal;
}

const updateAvailability = ['unknown', 'no-updates', 'available', 'required', 'error'] as const;

function unsupportedError(): Error & { code: string } {
    return Object.assign(new Error('Windows App Installer is not supported on this platform'), {
        code: 'ERR_WINDOWS_APP_INSTALLER_UNSUPPORTED',
    });
}

function validateAppInstallerURI(value: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('App Installer URI must be a non-empty string');
    }
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new TypeError('App Installer URI must be absolute');
    }
    if (!['file:', 'https:'].includes(url.protocol)) {
        throw new TypeError(`Unsupported App Installer URI protocol: ${url.protocol}`);
    }
    return url.href;
}

export const windowsAppInstaller = {
    isSupported(): boolean {
        return native?.isSupported() === true;
    },

    async getPackageIdentity(): Promise<WindowsPackageIdentity | null> {
        if (!this.isSupported()) return null;
        return native!.getPackageIdentity();
    },

    async checkForUpdates(): Promise<WindowsAppInstallerUpdateAvailability> {
        if (!this.isSupported()) throw unsupportedError();
        const status = await native!.checkForUpdates();
        if (!Number.isInteger(status) || status < 0 || status >= updateAvailability.length) {
            throw new Error(`Windows returned an unknown update availability value: ${status}`);
        }
        return updateAvailability[status];
    },

    async install(uri: string, options: WindowsAppInstallerInstallOptions = {}): Promise<void> {
        if (!this.isSupported()) throw unsupportedError();
        if (options.signal?.aborted) throw new DOMException('App Installer operation was cancelled', 'AbortError');
        const normalizedURI = validateAppInstallerURI(uri);
        const nativeOptions =
            (options.installAllResources ? 0x20 : 0) |
            (options.forceTargetApplicationShutdown ? 0x40 : 0) |
            (options.requiredContentGroupOnly ? 0x100 : 0) |
            (options.limitToExistingPackages ? 0x200 : 0);
        const operation = native!.install(normalizedURI, nativeOptions, (state, percent) => {
            options.onProgress?.({
                percent: Math.max(0, Math.min(100, percent)),
                state: state === 0 ? 'queued' : 'processing',
            });
        });
        const abort = () => operation.cancel();
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            await operation.promise;
        }
        catch (error) {
            if (options.signal?.aborted) {
                throw new DOMException('App Installer operation was cancelled', 'AbortError');
            }
            throw error;
        }
        finally {
            options.signal?.removeEventListener('abort', abort);
        }
    },
};