import path = require('path');
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
    if (typeof packageJSON.version === 'string') info.version = packageJSON.version;
}
catch (e) { }

export default info;
