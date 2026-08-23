import { resolve } from 'path';
import { NativeImageNative } from './internal/native';

export interface Size {
    width: number;
    height: number;
}

export interface Rectangle extends Size {
    x: number;
    y: number;
}

export interface CreateFromBitmapOptions extends Size {
    scaleFactor: number;
}

export interface ResizeOptions {
    width?: number;
    height?: number;
    quality?: 'good' | 'better' | 'best';
}

export interface AddRepresentationOptions {
    scaleFactor?: number;
    width?: number;
    height?: number;
    buffer?: Buffer;
    dataURL?: string;
}

export class NativeImage {
    /** @internal */
    constructor(readonly native_: NativeImageNative) {}

    addRepresentation(options: AddRepresentationOptions): void {
        const buffer = options.buffer || (options.dataURL == null ? null : decodeImageDataURL(options.dataURL));
        if (buffer == null) throw new TypeError('buffer or dataURL is required');
        validateBitmapDimensions(options);
        this.native_.addRepresentation(buffer, options.width, options.height, options.scaleFactor);
    }

    crop(rectangle: Rectangle): NativeImage {
        return new NativeImage(this.native_.crop(rectangle));
    }

    getAspectRatio(scaleFactor?: number): number {
        return this.native_.getAspectRatio(scaleFactor);
    }

    getBitmap(options: { scaleFactor?: number } = {}): Buffer {
        return this.native_.getBitmap(options.scaleFactor);
    }

    getScaleFactors(): number[] {
        return this.native_.getScaleFactors();
    }

    getSize(scaleFactor?: number): Size {
        return this.native_.getSize(scaleFactor);
    }

    isEmpty(): boolean {
        return this.native_.isEmpty();
    }

    resize(options: ResizeOptions): NativeImage {
        return new NativeImage(this.native_.resize(options.width, options.height));
    }

    toBitmap(options: { scaleFactor?: number } = {}): Buffer {
        return this.native_.getBitmap(options.scaleFactor);
    }

    toDataURL(options: { scaleFactor?: number } = {}): string {
        return `data:image/png;base64,${this.toPNG(options).toString('base64')}`;
    }

    toJPEG(quality: number): Buffer {
        return this.native_.toJPEG(quality);
    }

    toPNG(options: { scaleFactor?: number } = {}): Buffer {
        return this.native_.toPNG(options.scaleFactor);
    }
}

function decodeImageDataURL(dataURL: string): Buffer {
    const match = /^data:image\/(?:png|jpeg);base64,([a-z0-9+/=]+)$/i.exec(dataURL);
    if (match == null) throw new TypeError('Invalid image data URL');
    return Buffer.from(match[1], 'base64');
}

function validateBitmapDimensions(options: { width?: number; height?: number }): void {
    if ((options.width == null) !== (options.height == null)) {
        throw new TypeError('Bitmap width and height must be specified together');
    }
    if (options.width != null &&
        (!Number.isInteger(options.width) || !Number.isInteger(options.height) ||
            options.width <= 0 || options.height! <= 0)) {
        throw new RangeError('Bitmap width and height must be positive integers');
    }
}

export const nativeImage = {
    createEmpty: (): NativeImage => new NativeImage(new NativeImageNative()),
    createFromBitmap: (buffer: Buffer, options: CreateFromBitmapOptions): NativeImage => {
        validateBitmapDimensions(options);
        return new NativeImage(new NativeImageNative(
            2, buffer, options.width, options.height, options.scaleFactor
        ));
    },
    createFromBuffer: (
        buffer: Buffer,
        options: { width?: number; height?: number; scaleFactor?: number } = {}
    ): NativeImage => {
        validateBitmapDimensions(options);
        return options.width == null
            ? new NativeImage(new NativeImageNative(1, buffer, options.scaleFactor))
            : new NativeImage(new NativeImageNative(
                2, buffer, options.width, options.height, options.scaleFactor
            ));
    },
    createFromDataURL: (dataURL: string): NativeImage =>
        new NativeImage(new NativeImageNative(1, decodeImageDataURL(dataURL))),
    createFromPath: (imagePath: string): NativeImage =>
        new NativeImage(new NativeImageNative(0, resolve(imagePath))),
};