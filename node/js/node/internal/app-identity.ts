import fs = require('fs');
import path = require('path');

const fallbackIdentity = {
    id: 'deskgap',
    name: 'DeskGap',
    storageName: 'DeskGap',
    version: null as string | null,
};

function safeStorageName(value: unknown): string | null {
    if (typeof value !== 'string' || value === '' || value === '.' || value === '..' ||
        /[\\/:*?"<>|\x00-\x1f]/.test(value) || /[. ]$/.test(value)) {
        return null;
    }
    return value;
}

function readEmbeddedIdentity() {
    try {
        const identityPath = path.join(process.resourcesPath, 'app-identity.json');
        const packagePath = path.join(process.resourcesPath, 'app', 'package.json');
        const packageJSON = JSON.parse(fs.readFileSync(fs.existsSync(identityPath) ? identityPath : packagePath, 'utf8'));
        const id = typeof packageJSON.name === 'string' && packageJSON.name !== '' ? packageJSON.name : fallbackIdentity.id;
        const name = typeof packageJSON.productName === 'string' && packageJSON.productName !== ''
            ? packageJSON.productName
            : id;
        return Object.freeze({
            id,
            name,
            storageName: safeStorageName(packageJSON.productName) || safeStorageName(packageJSON.name) || fallbackIdentity.storageName,
            version: typeof packageJSON.version === 'string' ? packageJSON.version : null,
        });
    }
    catch (_) {
        return Object.freeze(fallbackIdentity);
    }
}

export const embeddedAppIdentity = readEmbeddedIdentity();