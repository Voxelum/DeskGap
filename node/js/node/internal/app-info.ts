import path = require('path');
import fs = require('fs');
import appPath from './app-path';
import { embeddedAppIdentity } from './app-identity';

const info = {
    id: embeddedAppIdentity.id,
    name: embeddedAppIdentity.name,
    version: embeddedAppIdentity.version,
}

const packageJSONPath = path.join(appPath, 'package.json');
try {
    const packageJSON = require(packageJSONPath);
    const developmentEntry = process.env.DESKGAP_ENTRY;
    if (developmentEntry != null && path.resolve(developmentEntry) === path.resolve(appPath) &&
        fs.existsSync(path.join(process.resourcesPath, 'app', 'DESKGAP_DEFAULT_APP'))) {
        if (typeof packageJSON.name === 'string' && packageJSON.name !== '') {
            info.id = packageJSON.name;
            info.name = packageJSON.name;
        }
        if (typeof packageJSON.productName === 'string' && packageJSON.productName !== '') {
            info.name = packageJSON.productName;
        }
    }
    if (typeof packageJSON.version === 'string') info.version = packageJSON.version;
}
catch (e) { }

export default info;
