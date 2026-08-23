import { EventEmitter, IEventMap } from './internal/events';
import { NotificationNative } from './internal/native';
import { NativeImage, nativeImage } from './native-image';

export interface NotificationOptions {
    title: string;
    body?: string;
    icon?: string | NativeImage;
    silent?: boolean;
}

export interface NotificationEvents extends IEventMap {
    click: [];
    close: [];
    failed: [string];
    show: [];
}

const maximumNotificationIconBytes = 5 * 1024 * 1024;

export class Notification extends EventEmitter<NotificationEvents> {
    private readonly native_: NotificationNative;

    constructor(options: NotificationOptions) {
        super();
        if (options == null || typeof options.title !== 'string' || options.title.length === 0) {
            throw new TypeError('Notification title is required');
        }
        const icon = typeof options.icon === 'string'
            ? nativeImage.createFromPath(options.icon)
            : options.icon;
        const iconPng = icon == null || icon.isEmpty() ? Buffer.alloc(0) : icon.toPNG();
        if (iconPng.byteLength > maximumNotificationIconBytes) {
            throw new RangeError('Notification icon exceeds the 5 MiB limit');
        }
        this.native_ = new NotificationNative({
            title: options.title,
            body: options.body || '',
            iconPng,
            silent: !!options.silent,
        }, {
            onShow: () => this.trigger_('show'),
            onClick: () => this.trigger_('click'),
            onClose: () => this.trigger_('close'),
            onFailed: (error: string) => this.trigger_('failed', null, error),
        });
    }

    show(): void {
        this.native_.show();
    }

    close(): void {
        this.native_.close();
    }

    static isSupported(): boolean {
        return NotificationNative.isSupported();
    }
}
