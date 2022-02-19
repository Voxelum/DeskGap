const deskgapVersion = require('../../VERSION.txt');

const { appNative } = require('./bindings');

declare global {
    namespace NodeJS {
        interface Process {
            resourcesPath: string;
        }
        interface ProcessVersions {
            readonly deskgap: string;
        }
    }
}

process.resourcesPath = appNative.getResourcePath();
process.argv = appNative.getArgv();

Object.defineProperty(process.versions, 'deskgap', {
    value: deskgapVersion,
    writable: false,
    configurable: true,
    enumerable: false
});

export { }
