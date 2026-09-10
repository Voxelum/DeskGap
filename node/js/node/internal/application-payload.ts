import fs = require('fs');
import path = require('path');
import semver = require('semver');
import { randomUUID } from 'crypto';
import { embeddedAppIdentity } from './app-identity';
import { appNative } from './native';
import { validateApplicationEntry } from './application-entry';

export const runtimeApiVersion = 1;
export const payloadCompletionFileName = '.deskgap-payload.json';

const embeddedAppPath = path.join(process.resourcesPath, 'app');

interface Payload {
    sha256: string;
    version: string;
    requiredRuntimeApi: number;
    runtimeHash?: string;
    directory: string;
}

function readObject(file: string): Record<string, unknown> | null {
    try {
        if (!fs.lstatSync(file).isFile()) return null;
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value != null && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    catch (_) { return null; }
}

function validVersion(value: unknown): value is string {
    return typeof value === 'string' && semver.valid(value) != null;
}

function readPayload(root: string, marker: Record<string, unknown> | null, bundledRuntimeHash?: string): Payload | null {
    if (marker == null || typeof marker.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sha256) ||
        !validVersion(marker.version)) return null;
    if ('runtimeHash' in marker && (typeof marker.runtimeHash !== 'string' || !/^[a-f0-9]{64}$/.test(marker.runtimeHash) ||
        (bundledRuntimeHash != null && marker.runtimeHash !== bundledRuntimeHash))) return null;
    const runtimeHash = bundledRuntimeHash ?? (marker.runtimeHash as string | undefined);
    const directory = path.join(root, 'payloads', marker.sha256);
    try {
        if (runtimeHash != null) {
            if (!fs.lstatSync(path.join(root, '..', 'runtime', runtimeHash)).isDirectory()) return null;
            const bundle = readObject(path.join(root, 'bundles', `${runtimeHash}.json`));
            if (bundle == null || bundle.sha256 !== marker.sha256 || !validVersion(bundle.version) ||
                !semver.eq(bundle.version, marker.version)) return null;
        }
        if (!fs.lstatSync(directory).isDirectory()) return null;
        const completion = readObject(path.join(directory, payloadCompletionFileName));
        const packageJSON = readObject(path.join(directory, 'package.json'));
        if (completion == null || completion.sha256 !== marker.sha256 || !validVersion(completion.version) ||
            !semver.eq(completion.version, marker.version) || packageJSON == null ||
            !validVersion(packageJSON.version) || !semver.eq(packageJSON.version, marker.version)) return null;
        // A full bundle is paired with this exact runtime. Legacy updater markers predate API 2.
        const requiredRuntimeApi = 'requiredRuntimeApi' in marker ? marker.requiredRuntimeApi
            : 'requiredRuntimeApi' in completion ? completion.requiredRuntimeApi : bundledRuntimeHash != null ? runtimeApiVersion : 1;
        if (typeof requiredRuntimeApi !== 'number' || !Number.isSafeInteger(requiredRuntimeApi) ||
            requiredRuntimeApi < 1 ||
            ('requiredRuntimeApi' in completion && completion.requiredRuntimeApi !== requiredRuntimeApi)) return null;
        validateApplicationEntry(directory);
        return { sha256: marker.sha256, version: marker.version, requiredRuntimeApi, runtimeHash, directory };
    }
    catch (_) { return null; }
}

function persistPayload(root: string, payload: Payload): void {
    const activePath = path.join(root, 'active.json');
    const temporary = `${activePath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify({
            sha256: payload.sha256,
            version: payload.version,
            requiredRuntimeApi: payload.requiredRuntimeApi,
            runtimeHash: payload.runtimeHash,
        }), { flag: 'wx' });
        fs.renameSync(temporary, activePath);
    }
    finally {
        fs.rmSync(temporary, { force: true });
    }
}

export function getApplicationPayloadRoot(): string {
    if (appNative == null) throw new Error('Application payload storage is unavailable before native initialization');
    const localData = appNative.getPath(9);
    return process.platform === 'win32'
        ? path.join(localData, 'Programs', embeddedAppIdentity.storageName, 'application')
        : path.join(localData, embeddedAppIdentity.storageName, 'application');
}

export function resolveAppPath(): string {
    const envEntry = process.env['DESKGAP_ENTRY'];
    if (envEntry != null && fs.existsSync(path.join(embeddedAppPath, 'DESKGAP_DEFAULT_APP'))) {
        return envEntry;
    }

    let root: string;
    try { root = getApplicationPayloadRoot(); }
    catch (_) { return embeddedAppPath; }

    // Resolve the fallback for the running runtime, not the last launcher to write a global marker.
    const runtimeRelative = path.relative(path.join(root, '..', 'runtime'), process.resourcesPath);
    const runtimeComponent = runtimeRelative.split(path.sep)[0];
    const runtimeHash = process.platform === 'win32' && /^[a-f0-9]{64}$/.test(runtimeComponent) ? runtimeComponent : undefined;
    const compatible = (payload: Payload) => payload.requiredRuntimeApi <= runtimeApiVersion &&
        (payload.runtimeHash == null || payload.runtimeHash === runtimeHash);
    const marker = readObject(path.join(root, 'active.json'));
    const activePayload = readPayload(root, marker);
    const active = activePayload != null && compatible(activePayload) ? activePayload : null;
    const bundledPayload = runtimeHash != null
        ? readPayload(root, readObject(path.join(root, 'bundles', `${runtimeHash}.json`)), runtimeHash)
        : null;
    const bundle = bundledPayload != null && compatible(bundledPayload) ? bundledPayload : null;
    const selected = bundle != null && (active == null || semver.gt(bundle.version, active.version)) ? bundle : active;
    const embeddedVersion = embeddedAppIdentity.version;
    if (selected == null || (bundle == null && fs.existsSync(embeddedAppPath) && validVersion(embeddedVersion) &&
        semver.gt(embeddedVersion, selected.version))) return embeddedAppPath;

    if (selected !== active) {
        // Do not erase an activation intended for a newer runtime when an old runtime is launched directly.
        const incompatible = activePayload != null && semver.gte(activePayload.version, selected.version) && !compatible(activePayload);
        if (!incompatible) persistPayload(root, selected);
    }
    return selected.directory;
}