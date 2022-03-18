import path = require('path');
import appPath from './app-path';

const info = {
    name: 'DeskGap',
    version: null as string | null
}

const packageJSONPath = path.join(appPath, 'package.json');
try {
    const packageJSON = require(packageJSONPath);
    Object.assign(info, {
        name: packageJSON.productName || packageJSON.name,
        version: packageJSON.version
    });
}
catch (e) { }

export default info;
