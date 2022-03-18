import { shellNative } from './internal/native';
import { resolve } from 'path';

export const shell = {
    openExternal: (url: string): boolean => shellNative.openExternal(url),
    showItemInFolder: (path: string) => shellNative.showItemInFolder(resolve(path)),
};
