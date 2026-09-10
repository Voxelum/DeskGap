import { spawn } from 'child_process';
import { constants } from 'fs';
import { copyFile, lstat, mkdir, mkdtemp, rm } from 'fs/promises';
import path = require('path');
import { app } from './app';
import { windowsExecutableNative as native } from './internal/native';
import { fileVerificationFailure } from './internal/update-file';

export interface WindowsExecutableInstallOptions {
    publisherNames: readonly string[];
    args?: string[];
    quit?: boolean;
    sha256?: string;
}

function requireSupport(): void {
    if (!windowsExecutable.isSupported()) {
        throw Object.assign(new Error('Windows executable signature verification is not supported on this platform'), {
            code: 'ERR_WINDOWS_EXECUTABLE_UNSUPPORTED',
        });
    }
}

function validatePublishers(publisherNames: readonly string[]): string[] {
    if (!Array.isArray(publisherNames) || publisherNames.length === 0 ||
        publisherNames.some(value => typeof value !== 'string' || !value.trim() || value.includes('\0'))) {
        throw new TypeError('Expected publisherNames must be non-empty full X.500 subject strings');
    }
    return [...publisherNames];
}

async function executablePath(filePath: string): Promise<string> {
    if (typeof filePath !== 'string' || filePath.includes('\0') || path.extname(filePath).toLowerCase() !== '.exe') {
        throw new TypeError('Windows update must be an EXE file');
    }
    const resolved = path.resolve(filePath);
    const metadata = await lstat(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Windows update must be a regular file');
    return resolved;
}

export const windowsExecutable = {
    isSupported(): boolean {
        return process.platform === 'win32' && native != null;
    },

    async verifySignature(filePath: string, publisherNames: readonly string[]): Promise<void> {
        requireSupport();
        const publishers = validatePublishers(publisherNames);
        await native!.verifySignature(await executablePath(filePath), publishers);
    },

    async install(filePath: string, options: WindowsExecutableInstallOptions): Promise<void> {
        requireSupport();
        const publishers = validatePublishers(options.publisherNames);
        if (options.args !== undefined && (!Array.isArray(options.args) ||
            options.args.some(value => typeof value !== 'string' || value.includes('\0')))) {
            throw new TypeError('Windows installer arguments must be strings without NUL characters');
        }
        const args = [...(options.args || [])];
        const sha256 = options.sha256;
        const quit = options.quit === true;
        if (sha256 !== undefined && (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256))) {
            throw new TypeError('Windows update SHA-256 must contain 64 hexadecimal characters');
        }
        const source = await executablePath(filePath);
        const directory = path.join(app.getPath('localData'), 'updates');
        await mkdir(directory, { recursive: true });
        const stagingDirectory = await mkdtemp(path.join(directory, '.install-'));
        const stagedPath = path.join(stagingDirectory, path.basename(source));
        try {
            await copyFile(source, stagedPath, constants.COPYFILE_EXCL);
            if (sha256 !== undefined) {
                const failure = await fileVerificationFailure(stagedPath, undefined, sha256);
                if (failure !== null) throw new Error(`Windows update changed after download: ${failure}`);
            }
            await native!.verifySignature(stagedPath, publishers);
            const child = spawn(stagedPath, args, {
                cwd: stagingDirectory,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            await new Promise<void>((resolve, reject) => {
                child.once('spawn', resolve);
                child.once('error', reject);
            });
            child.unref();
        }
        catch (error) {
            try {
                await rm(stagingDirectory, { recursive: true, force: true });
            }
            catch (cleanupError) {
                throw Object.assign(new Error('Windows update failed and its staging directory could not be removed'), {
                    cause: error,
                    cleanupError,
                });
            }
            throw error;
        }
        if (quit) app.exit(0);
    },
};
