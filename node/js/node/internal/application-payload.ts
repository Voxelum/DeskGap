import fs = require('fs');
import path = require('path');
import { embeddedAppIdentity } from './app-identity';
import { appNative } from './native';

export const runtimeApiVersion = 1;
export const payloadCompletionFileName = '.deskgap-payload.json';

const embeddedAppPath = path.join(process.resourcesPath, 'app');

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

    try {
        const applicationPayloadRoot = getApplicationPayloadRoot();
        const active = JSON.parse(fs.readFileSync(path.join(applicationPayloadRoot, 'active.json'), 'utf8'));
        if (active == null || typeof active !== 'object' || !/^[a-f0-9]{64}$/.test(active.sha256)) {
            return embeddedAppPath;
        }
        const payloadPath = path.join(applicationPayloadRoot, 'payloads', active.sha256);
        const completion = JSON.parse(fs.readFileSync(path.join(payloadPath, payloadCompletionFileName), 'utf8'));
        if (completion.sha256 === active.sha256 && fs.statSync(payloadPath).isDirectory() &&
            fs.statSync(path.join(payloadPath, 'package.json')).isFile()) {
            return payloadPath;
        }
    }
    catch (_) { }
    return embeddedAppPath;
}