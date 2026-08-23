import { createHash, createPublicKey, KeyObject, randomUUID, verify as verifySignature } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { constants as fsConstants } from 'fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'fs/promises';
import path = require('path');
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { extract } from 'tar-stream';
import { createZstdDecompress } from 'zlib';
import semver = require('semver');
import { app } from './app';
import { getApplicationPayloadRoot, payloadCompletionFileName, runtimeApiVersion } from './internal/application-payload';
import { EventEmitter, IEventMap } from './internal/events';
import { Session, session } from './session';

const maximumManifestBytes = 256 * 1024;
const maximumUpdateBytes = 4 * 1024 * 1024 * 1024;

export interface UpdateAsset {
    arch: NodeJS.Architecture | 'any';
    format?: 'tar.zst';
    name: string;
    platform: NodeJS.Platform | 'any';
    requiredRuntimeApi?: number;
    sha256: string;
    size: number;
    type?: 'application' | 'runtime';
    unpackedSize?: number;
    url: string;
}

export interface UpdateManifest {
    assets: UpdateAsset[];
    releaseDate?: string;
    releaseNotes?: string;
    signature: string;
    version: string;
}

export interface UpdateInfo extends UpdateManifest {
    asset: UpdateAsset;
    manifestURL: string;
}

export interface DownloadedUpdate extends UpdateInfo {
    path: string;
}

export interface DownloadProgress {
    bytesPerSecond: number;
    percent: number;
    total: number;
    transferred: number;
}

export interface CheckForUpdatesOptions {
    allowPrerelease?: boolean;
    signal?: AbortSignal;
}

export interface DownloadUpdateOptions {
    directory?: string;
    signal?: AbortSignal;
}

export interface InstallUpdateOptions {
    args?: string[];
    quit?: boolean;
}

export interface UpdaterOptions {
    allowLoopback?: boolean;
    allowedOrigins?: string[];
    session?: Session;
    trustedPublicKey?: string | Buffer;
}

export interface UpdaterEvents extends IEventMap {
    'checking-for-update': [];
    'update-available': [UpdateInfo];
    'update-not-available': [];
    'download-progress': [DownloadProgress];
    'update-downloaded': [DownloadedUpdate];
    'error': [Error];
}

export class Updater extends EventEmitter<UpdaterEvents> {
    private readonly verifiedArtifacts_ = new Map<string, string>();
    private readonly approvedUpdates_ = new WeakSet<UpdateInfo>();
    private readonly activeDownloads_ = new Set<string>();
    private readonly session_: Session;
    private readonly trustedPublicKey_: KeyObject | null;
    private readonly allowLoopback_: boolean;
    private readonly allowedOrigins_: Set<string>;

    constructor(options: UpdaterOptions = {}) {
        super();
        this.session_ = options.session || session.defaultSession;
        this.allowLoopback_ = !!options.allowLoopback;
        this.allowedOrigins_ = new Set((options.allowedOrigins || []).map(value => secureURL(value, this.allowLoopback_).origin));
        this.trustedPublicKey_ = options.trustedPublicKey == null ? null : createPublicKey(options.trustedPublicKey);
        if (this.trustedPublicKey_ != null && this.trustedPublicKey_.asymmetricKeyType !== 'ed25519') {
            throw new TypeError('Updater trustedPublicKey must be an Ed25519 public key');
        }
    }

    async checkForUpdates(manifestURL: string, options: CheckForUpdatesOptions = {}): Promise<UpdateInfo | null> {
        this.trigger_('checking-for-update');
        try {
            if (this.trustedPublicKey_ == null) throw new Error('Updater requires a trusted Ed25519 public key');
            const url = secureURL(manifestURL, this.allowLoopback_);
            const response = await secureFetch(this.session_, url, {
                headers: { Accept: 'application/json' },
                signal: options.signal,
            }, new Set([url.origin, ...this.allowedOrigins_]), this.allowLoopback_);
            if (!response.ok) throw new Error(`Update manifest request failed with status ${response.status}`);
            secureURL(response.url || url.href, this.allowLoopback_);
            const manifest = parseManifest(await readLimitedText(response, maximumManifestBytes));
            verifyManifestSignature(manifest, this.trustedPublicKey_);
            const currentVersion = app.getVersion();
            if (currentVersion == null || semver.valid(currentVersion) == null) {
                throw new Error(`Current application version is not valid semver: ${currentVersion}`);
            }
            const version = semver.valid(manifest.version);
            if (version == null) throw new Error(`Update version is not valid semver: ${manifest.version}`);
            if (!options.allowPrerelease && semver.prerelease(version) != null) {
                this.trigger_('update-not-available');
                return null;
            }
            if (!semver.gt(version, currentVersion)) {
                this.trigger_('update-not-available');
                return null;
            }
            const matchingAssets = manifest.assets.filter(candidate =>
                (candidate.platform === process.platform || candidate.platform === 'any') &&
                (candidate.arch === process.arch || candidate.arch === 'any')
            );
            const asset = matchingAssets.find(candidate =>
                candidate.type === 'application' && candidate.requiredRuntimeApi! <= runtimeApiVersion
            ) || matchingAssets.find(candidate => candidate.type !== 'application');
            if (asset == null) throw new Error(`No update asset for ${process.platform}-${process.arch}`);
            const manifestBaseURL = secureURL(response.url || url.href, this.allowLoopback_);
            const assetURL = secureURL(new URL(asset.url, manifestBaseURL).href, this.allowLoopback_);
            if (assetURL.origin !== manifestBaseURL.origin && !this.allowedOrigins_.has(assetURL.origin)) {
                throw new Error(`Update asset origin is not allowed: ${assetURL.origin}`);
            }
            const update: UpdateInfo = {
                ...manifest,
                asset: Object.freeze({ ...asset, url: assetURL.href }),
                assets: Object.freeze(manifest.assets.map(candidate => Object.freeze({ ...candidate }))) as unknown as UpdateAsset[],
                manifestURL: url.href,
            };
            Object.freeze(update);
            this.approvedUpdates_.add(update);
            this.trigger_('update-available', null, update);
            return update;
        }
        catch (error) {
            const normalized = error instanceof Error ? error : new Error('Update check failed');
            this.emitError_(normalized);
            throw normalized;
        }
    }

    async downloadUpdate(update: UpdateInfo, options: DownloadUpdateOptions = {}): Promise<DownloadedUpdate> {
        if (!this.approvedUpdates_.has(update)) {
            throw new Error('Update metadata was not returned by this Updater after signature verification');
        }
        const directory = path.resolve(options.directory || path.join(app.getPath('localData'), 'updates', update.version));
        const finalPath = path.join(directory, safeFileName(update.asset.name));
        const temporaryPath = `${finalPath}.${randomUUID()}.part`;
        if (this.activeDownloads_.has(finalPath)) throw new Error('An update download is already writing this artifact');
        this.activeDownloads_.add(finalPath);
        await mkdir(directory, { recursive: true });

        try {
            const existing = await verifyFile(finalPath, update.asset.size, update.asset.sha256).catch(() => false);
            if (!existing) {
                const assetURL = secureURL(update.asset.url, this.allowLoopback_);
                const manifestOrigin = secureURL(update.manifestURL, this.allowLoopback_).origin;
                const response = await secureFetch(
                    this.session_,
                    assetURL,
                    { signal: options.signal },
                    new Set([manifestOrigin, assetURL.origin, ...this.allowedOrigins_]),
                    this.allowLoopback_,
                );
                if (!response.ok || response.body == null) {
                    throw new Error(`Update download failed with status ${response.status}`);
                }
                secureURL(response.url || update.asset.url, this.allowLoopback_);
                const contentLength = Number(response.headers.get('content-length'));
                if (Number.isFinite(contentLength) && contentLength !== update.asset.size) {
                    throw new Error(`Update size mismatch: expected ${update.asset.size}, received ${contentLength}`);
                }
                await this.writeDownload_(response, temporaryPath, update.asset, options.signal);
                await rm(finalPath, { force: true });
                await rename(temporaryPath, finalPath);
            }
            const downloaded: DownloadedUpdate = { ...update, path: finalPath };
            this.verifiedArtifacts_.set(finalPath, update.asset.sha256.toLowerCase());
            this.trigger_('update-downloaded', null, downloaded);
            return downloaded;
        }
        catch (error) {
            await rm(temporaryPath, { force: true }).catch(() => {});
            const normalized = error instanceof Error ? error : new Error('Update download failed');
            this.emitError_(normalized);
            throw normalized;
        }
        finally {
            this.activeDownloads_.delete(finalPath);
        }
    }

    async install(update: DownloadedUpdate, options: InstallUpdateOptions = {}): Promise<void> {
        const artifactPath = path.resolve(update.path);
        const expectedHash = this.verifiedArtifacts_.get(artifactPath);
        if (expectedHash == null || expectedHash !== update.asset.sha256.toLowerCase()) {
            throw new Error('Update artifact was not downloaded and verified by this Updater');
        }
        const verificationFailure = await fileVerificationFailure(artifactPath, update.asset.size, expectedHash);
        if (verificationFailure != null) {
            this.verifiedArtifacts_.delete(artifactPath);
            throw new Error(`Update artifact changed after verification: ${verificationFailure}`);
        }

        if (update.asset.type === 'application') {
            await installApplicationPayload(artifactPath, update);
            if (options.quit === true) {
                app.relaunch({ args: options.args });
                app.exit(0);
            }
            return;
        }

        const stagingDirectory = await mkdtemp(path.join(path.dirname(artifactPath), '.install-'));
        await chmod(stagingDirectory, 0o700).catch(() => {});
        const stagedPath = path.join(stagingDirectory, path.basename(artifactPath));
        try {
            await copyFile(artifactPath, stagedPath, fsConstants.COPYFILE_EXCL);
            if (!await verifyFile(stagedPath, update.asset.size, expectedHash)) {
                throw new Error('Staged update artifact failed verification');
            }
        }
        catch (error) {
            await rm(stagingDirectory, { force: true, recursive: true }).catch(() => {});
            throw error;
        }

        const command = await installerCommand(stagedPath, options.args || []);
        const child = spawn(command.file, command.args, {
            cwd: stagingDirectory,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        try {
            await new Promise<void>((resolve, reject) => {
                child.once('spawn', resolve);
                child.once('error', reject);
            });
        }
        catch (error) {
            await rm(stagingDirectory, { force: true, recursive: true }).catch(() => {});
            throw error;
        }
        child.unref();
        if (options.quit === true) app.exit(0);
    }

    async quitAndInstall(update: DownloadedUpdate, options: Omit<InstallUpdateOptions, 'quit'> = {}): Promise<void> {
        await this.install(update, { ...options, quit: true });
    }

    private async writeDownload_(
        response: Response,
        temporaryPath: string,
        asset: UpdateAsset,
        signal?: AbortSignal,
    ): Promise<void> {
        const file = await open(temporaryPath, 'wx');
        const reader = response.body!.getReader();
        const abort = () => { void reader.cancel(new DOMException('Update download was cancelled', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        const hash = createHash('sha256');
        const startedAt = Date.now();
        let transferred = 0;
        try {
            while (true) {
                if (signal?.aborted) throw new DOMException('Update download was cancelled', 'AbortError');
                const { value, done } = await reader.read();
                if (done) break;
                transferred += value.byteLength;
                if (transferred > asset.size) throw new Error('Update download exceeds the declared size');
                hash.update(value);
                let offset = 0;
                while (offset < value.byteLength) {
                    const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
                    if (bytesWritten === 0) throw new Error('Update file write made no progress');
                    offset += bytesWritten;
                }
                const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
                this.trigger_('download-progress', null, {
                    bytesPerSecond: transferred / elapsedSeconds,
                    percent: transferred / asset.size * 100,
                    total: asset.size,
                    transferred,
                });
            }
        }
        finally {
            signal?.removeEventListener('abort', abort);
            await reader.cancel().catch(() => {});
            await file.close();
        }
        if (transferred !== asset.size) {
            throw new Error(`Update size mismatch: expected ${asset.size}, received ${transferred}`);
        }
        const digest = hash.digest('hex');
        if (digest !== asset.sha256.toLowerCase()) throw new Error('Update SHA-256 mismatch');
    }

    private emitError_(error: Error): void {
        if (this.listenerCount('error') > 0) this.trigger_('error', null, error);
    }
}

export const updater = new Updater();

function parseManifest(serialized: string): UpdateManifest {
    let value: any;
    try { value = JSON.parse(serialized); }
    catch (_) { throw new Error('Update manifest is not valid JSON'); }
    if (value == null || typeof value !== 'object' || typeof value.version !== 'string' ||
        typeof value.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature) ||
        !Array.isArray(value.assets)) {
        throw new Error('Update manifest has an invalid shape');
    }
    const assets = value.assets.map((asset: any): UpdateAsset => {
        if (asset == null || typeof asset !== 'object' || typeof asset.name !== 'string' ||
            typeof asset.url !== 'string' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256) ||
            !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maximumUpdateBytes ||
            typeof asset.platform !== 'string' || typeof asset.arch !== 'string') {
            throw new Error('Update manifest contains an invalid asset');
        }
        const type = asset.type === undefined ? undefined : asset.type;
        if (type !== undefined && type !== 'application' && type !== 'runtime') {
            throw new Error('Update manifest contains an invalid asset type');
        }
        if (type === 'application' && (asset.format !== 'tar.zst' ||
            !Number.isSafeInteger(asset.requiredRuntimeApi) || asset.requiredRuntimeApi <= 0 ||
            !Number.isSafeInteger(asset.unpackedSize) || asset.unpackedSize <= 0 || asset.unpackedSize > maximumUpdateBytes)) {
            throw new Error('Application update assets must declare tar.zst format, runtime API, and unpacked size');
        }
        if (type !== 'application' && (asset.format !== undefined || asset.requiredRuntimeApi !== undefined || asset.unpackedSize !== undefined)) {
            throw new Error('Runtime update assets cannot declare application payload metadata');
        }
        return {
            arch: asset.arch,
            format: asset.format,
            name: asset.name,
            platform: asset.platform,
            requiredRuntimeApi: asset.requiredRuntimeApi,
            sha256: asset.sha256.toLowerCase(),
            size: asset.size,
            type,
            unpackedSize: asset.unpackedSize,
            url: asset.url,
        };
    });
    return {
        assets,
        releaseDate: typeof value.releaseDate === 'string' ? value.releaseDate : undefined,
        releaseNotes: typeof value.releaseNotes === 'string' ? value.releaseNotes : undefined,
        signature: value.signature,
        version: value.version,
    };
}

export function serializeUpdateManifestForSignature(manifest: Omit<UpdateManifest, 'signature'>): string {
    return canonicalJSON(manifest);
}

function verifyManifestSignature(manifest: UpdateManifest, publicKey: KeyObject): void {
    const { signature, ...unsigned } = manifest;
    let signatureBytes: Buffer;
    try { signatureBytes = Buffer.from(signature, 'base64'); }
    catch (_) { throw new Error('Update manifest signature is invalid'); }
    if (!verifySignature(null, Buffer.from(serializeUpdateManifestForSignature(unsigned)), publicKey, signatureBytes)) {
        throw new Error('Update manifest signature verification failed');
    }
}

function canonicalJSON(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
    if (response.body == null) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumBytes) throw new Error('Update manifest is too large');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => {});
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(result);
}

function secureURL(value: string | URL, allowLoopback: boolean): URL {
    const url = value instanceof URL ? value : new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && loopback)) {
        throw new Error('Updater URLs must use HTTPS or loopback HTTP');
    }
    if (url.username !== '' || url.password !== '') throw new Error('Updater URLs cannot contain credentials');
    return url;
}

function safeFileName(value: string): string {
    if (value === '' || value === '.' || value === '..' || path.basename(value) !== value || /[\\/:*?"<>|\x00-\x1f]/.test(value)) {
        throw new Error('Update asset name is unsafe');
    }
    return value;
}

async function verifyFile(filePath: string, size: number, sha256: string): Promise<boolean> {
    return await fileVerificationFailure(filePath, size, sha256) == null;
}

async function fileVerificationFailure(filePath: string, size: number, sha256: string): Promise<string | null> {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return 'artifact is not a regular file';
    if (metadata.size !== size) return `expected ${size} bytes, received ${metadata.size}`;
    const canonicalParent = await realpath(path.dirname(filePath));
    const canonicalPath = path.join(canonicalParent, path.basename(filePath));
    if (normalizePath(await realpath(filePath)) !== normalizePath(canonicalPath)) return 'artifact path resolves outside its download location';
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    const digest = hash.digest('hex');
    return digest === sha256.toLowerCase() ? null : 'SHA-256 mismatch';
}

async function secureFetch(
    fetchSession: Session,
    input: string | URL,
    init: RequestInit,
    allowedOrigins: Set<string>,
    allowLoopback: boolean,
): Promise<Response> {
    let url = secureURL(input, allowLoopback);
    if (!allowedOrigins.has(url.origin)) throw new Error(`Updater origin is not allowed: ${url.origin}`);
    for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await fetchSession.fetch(url, { ...init, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (location == null) throw new Error('Update redirect is missing a Location header');
        await response.body?.cancel().catch(() => {});
        if (redirects === 5) throw new Error('Updater redirect limit exceeded');
        url = secureURL(new URL(location, url), allowLoopback);
        if (!allowedOrigins.has(url.origin)) throw new Error(`Updater redirect origin is not allowed: ${url.origin}`);
    }
    throw new Error('Updater redirect limit exceeded');
}

async function installerCommand(artifactPath: string, args: string[]): Promise<{ file: string; args: string[] }> {
    const extension = path.extname(artifactPath).toLowerCase();
    if (process.platform === 'win32') {
        if (extension === '.exe') return { file: artifactPath, args };
        if (extension === '.msi') {
            const systemRoot = process.env.SystemRoot || 'C:\\Windows';
            return { file: path.join(systemRoot, 'System32', 'msiexec.exe'), args: ['/i', artifactPath, ...args] };
        }
    }
    else if (process.platform === 'darwin') {
        if (extension === '.pkg' || extension === '.dmg') {
            if (args.length > 0) throw new Error('Installer arguments are not supported for macOS package updates');
            return { file: '/usr/bin/open', args: [artifactPath] };
        }
    }
    else if (process.platform === 'linux') {
        if (extension === '.appimage') {
            await chmod(artifactPath, 0o755);
            return { file: artifactPath, args };
        }
        if (extension === '.deb' || extension === '.rpm') {
            if (args.length > 0) throw new Error('Installer arguments are not supported for Linux package updates');
            return { file: '/usr/bin/xdg-open', args: [artifactPath] };
        }
    }
    throw new Error(`Unsupported update artifact type on ${process.platform}: ${extension || '(none)'}`);
}

function normalizePath(value: string): string {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}

async function installApplicationPayload(artifactPath: string, update: DownloadedUpdate): Promise<void> {
    const asset = update.asset;
    if (asset.format !== 'tar.zst' || asset.unpackedSize == null || asset.requiredRuntimeApi == null) {
        throw new Error('Application update metadata is incomplete');
    }
    if (asset.requiredRuntimeApi > runtimeApiVersion) {
        throw new Error(`Application update requires runtime API ${asset.requiredRuntimeApi}, but this runtime provides ${runtimeApiVersion}`);
    }

    const applicationPayloadRoot = getApplicationPayloadRoot();
    const payloadsDirectory = path.join(applicationPayloadRoot, 'payloads');
    const finalDirectory = path.join(payloadsDirectory, asset.sha256);
    const completionPath = path.join(finalDirectory, payloadCompletionFileName);
    await mkdir(payloadsDirectory, { recursive: true });

    let alreadyExtracted = false;
    try {
        const completion = JSON.parse(await readFile(completionPath, 'utf8'));
        alreadyExtracted = completion.sha256 === asset.sha256 && completion.version === update.version;
    }
    catch (_) { }

    if (!alreadyExtracted) {
        const stagingDirectory = await mkdtemp(path.join(payloadsDirectory, '.extract-'));
        try {
            await extractApplicationPayload(artifactPath, stagingDirectory, asset.unpackedSize);
            await validateApplicationPackage(stagingDirectory);
            await writeFile(path.join(stagingDirectory, payloadCompletionFileName), JSON.stringify({
                sha256: asset.sha256,
                version: update.version,
            }));
            await rm(finalDirectory, { force: true, recursive: true });
            await rename(stagingDirectory, finalDirectory);
        }
        catch (error) {
            await rm(stagingDirectory, { force: true, recursive: true }).catch(() => {});
            throw error;
        }
    }

    await mkdir(applicationPayloadRoot, { recursive: true });
    const activePath = path.join(applicationPayloadRoot, 'active.json');
    const temporaryActivePath = `${activePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryActivePath, JSON.stringify({ sha256: asset.sha256, version: update.version }), { flag: 'wx' });
    await rename(temporaryActivePath, activePath);
}

async function extractApplicationPayload(artifactPath: string, destination: string, expectedSize: number): Promise<void> {
    const archive = extract();
    const entries = new Set<string>();
    let extractedSize = 0;
    let entryCount = 0;

    archive.on('entry', (header, stream, next) => {
        void (async () => {
            const relativePath = safeArchivePath(header.name);
            if (entries.has(relativePath)) throw new Error(`Application payload contains a duplicate path: ${relativePath}`);
            entries.add(relativePath);
            entryCount++;
            if (entryCount > 100_000) throw new Error('Application payload contains too many entries');
            if (relativePath === payloadCompletionFileName) throw new Error('Application payload contains a reserved path');

            const destinationPath = path.join(destination, ...relativePath.split('/'));
            if (header.type === 'directory') {
                await mkdir(destinationPath, { recursive: true, mode: 0o755 });
                stream.resume();
                return;
            }
            if (header.type !== 'file' && header.type !== undefined) {
                throw new Error(`Application payload contains unsupported entry type: ${header.type}`);
            }
            const size = header.size || 0;
            extractedSize += size;
            if (extractedSize > expectedSize) throw new Error('Application payload exceeds its declared unpacked size');
            await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o755 });
            const mode = header.mode != null && (header.mode & 0o111) !== 0 ? 0o755 : 0o644;
            await pipeline(stream, createWriteStream(destinationPath, { flags: 'wx', mode }));
        })().then(() => next(), next);
    });

    await pipeline(createReadStream(artifactPath), createZstdDecompress(), archive);
    if (extractedSize !== expectedSize) {
        throw new Error(`Application payload unpacked size mismatch: expected ${expectedSize}, received ${extractedSize}`);
    }
}

function safeArchivePath(value: string): string {
    if (value === '' || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) {
        throw new Error('Application payload contains an unsafe path');
    }
    const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value;
    const segments = withoutTrailingSlash.split('/');
    const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' ||
        /[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || windowsReservedName.test(segment))) {
        throw new Error('Application payload contains an unsafe path');
    }
    return segments.join('/');
}

async function validateApplicationPackage(directory: string): Promise<void> {
    let packageJSON: any;
    try {
        packageJSON = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    }
    catch (_) {
        throw new Error('Application payload does not contain a valid package.json');
    }
    if (packageJSON == null || typeof packageJSON !== 'object' ||
        typeof packageJSON.name !== 'string' || packageJSON.name === '' ||
        (packageJSON.main !== undefined && typeof packageJSON.main !== 'string')) {
        throw new Error('Application payload package.json has an invalid shape');
    }
}
