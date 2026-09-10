import fs = require('fs');
import path = require('path');

export function validateApplicationEntry(directory: string): void {
    try {
        const entry = require.resolve(directory);
        const relativeEntry = path.relative(fs.realpathSync(directory), fs.realpathSync(entry));
        if (path.isAbsolute(relativeEntry) || relativeEntry === '..' || relativeEntry.startsWith(`..${path.sep}`) ||
            !fs.lstatSync(entry).isFile()) {
            throw new Error('Application payload entry must be a regular file inside its directory');
        }
    }
    catch (error) {
        if (error instanceof Error && 'code' in error &&
            (error.code === 'MODULE_NOT_FOUND' || error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
            throw new Error('Application payload entry does not exist');
        }
        throw error;
    }
}
