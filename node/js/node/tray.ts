import { bulkUISync } from './internal/dispatch';
import { EventEmitter, IEventMap } from './internal/events';
import { TrayNative } from './internal/native';
import { Menu, MenuTypeCode } from './menu';


export type MenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox';

export interface TrayEvents extends IEventMap {
    'click': []
}

export class Tray extends EventEmitter<TrayEvents> {
    /** @internal */
    private native_: TrayNative | undefined;

    private menu_: Menu | undefined;

    constructor(iconPath: string) {
        super();
        this.native_ = new TrayNative(iconPath, {
            onClick: () => {
                if (this.native_) {
                    this.trigger_('click')
                }
            },
            onDoubleClick: () => {
                if (this.native_) {
                    this.trigger_('double-click')
                }
            },
            onRightClick: () => {
                if (this.native_) {
                    this.trigger_('right-click', {
                        defaultAction: () => {
                            if (this.native_ && this.menu_) {
                                bulkUISync(() => {
                                    if (this.native_ && this.menu_) {
                                        const result = this.menu_.createNative_(MenuTypeCode.context, null);
                                        const nativeId = result[0];
                                        const native = result[1];
                                        this.native_.popupMenu(native, () => {
                                            bulkUISync(() => {
                                                if (this.menu_) {
                                                    this.menu_.destroyNative_(nativeId);
                                                }
                                            });
                                        });
                                    }
                                });
                            }
                        }
                    })
                }
            },
        });
    }

    setTitle(title: string) {
        bulkUISync(() => {
            this.native_?.setTitle(title);
        })
    }

    setTooltip(tooltip: string) {
        bulkUISync(() => {
            this.native_?.setTooltip(tooltip);
        })
    }

    setIcon(iconPath: string) {
        bulkUISync(() => {
            this.native_?.setIcon(iconPath);
        })
    }

    setContextMenu(menu: Menu) {
        this.menu_ = menu
    }

    isDestroyed() {
        return !!this.native_;
    }

    destroy() {
        bulkUISync(() => {
            this.native_?.destroy();
        })
    }
};

