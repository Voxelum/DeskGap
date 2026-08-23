import { clipboardNative } from './internal/native';
import { NativeImage } from './native-image';

export const clipboard = {
    readText(): string {
        return clipboardNative.readText();
    },

    writeText(text: string): void {
        if (!clipboardNative.writeText(text)) throw new Error('Failed to write text to the clipboard');
    },

    writeImage(image: NativeImage): void {
        if (!(image instanceof NativeImage)) throw new TypeError('image must be a NativeImage');
        if (!clipboardNative.writeImage(image.toPNG())) throw new Error('Failed to write image to the clipboard');
    },
};
