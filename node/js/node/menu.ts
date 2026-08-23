import { bulkUISync } from './internal/dispatch';
import { parseAcceleratorToTokens } from './accelerator';
import globals from './internal/globals';
import type { BrowserWindow } from './browser-window'
import roleDefaults, { Role } from './internal/menu/roles';
import { MenuItemNative, MenuNative } from './internal/native';

export type MenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';

/** @internal */
const MenuItemTypeCode = {
    normal: 0, separator: 1, submenu: 2, checkbox: 3, radio: 4
};

/** @internal */
type MenuType = 'main' | 'context' | 'submenu';

export const MenuTypeCode = {
    main: 0, context: 1, submenu: 2
};

export interface MenuItemConstructorOptions {
    id: string;
    role: Role;
    submenu: Array<Partial<MenuItemConstructorOptions> | null> | Menu;
    type: MenuItemType;
    label: string;
    enabled: boolean;
    checked: boolean;
    click: (item: MenuItem, window: BrowserWindow) => void;
    accelerator: string;
}

export interface IMenuPopupOptions {
    window?: BrowserWindow; x?: number; y?: number; positioningItem?: number; callback?: () => void;
}

let lastNativeId: number = 0;

export const MenuNativeKey = Symbol('MenuNative')

export class Menu {
    /** @internal */ private natives_ = new Map<number, MenuNative>();
    /** @internal */ private parentItem_: MenuItem | null = null;
    public items: MenuItem[] = [];

    /** @internal */ private nativeCallbacks_ = {};

    append(menuItem: MenuItem): void {
        if (!(menuItem instanceof MenuItem)) {
            throw new TypeError('Menu#append requires a MenuItem');
        }
        if (menuItem.menu != null) {
            throw new Error('MenuItem is already attached to a menu');
        }
        if (menuItem.submenu != null && menuItem.submenu.containsMenu_(this)) {
            throw new Error('Cannot create a cyclic menu hierarchy');
        }

        menuItem.menu = this;
        this.items.push(menuItem);
        if (menuItem.type === 'radio') {
            this.updateRadioGroup_(menuItem, menuItem['checkedExplicit_'] && menuItem.checked);
        }
    }

    popup(optionsOrWindow?: BrowserWindow | IMenuPopupOptions): void {
        const options: IMenuPopupOptions | undefined = optionsOrWindow != null && 'native_' in optionsOrWindow
            ? { window: optionsOrWindow as BrowserWindow }
            : optionsOrWindow as IMenuPopupOptions | undefined;

        const fullOptions: IMenuPopupOptions = Object.assign({
            window: globals.focusedBrowserWindow,
            positioningItem: -1
        }, options);

        if ((fullOptions.x == null) !== (fullOptions.y == null)) {
            throw new TypeError('Menu#popup requires both x and y coordinates');
        }
        if (fullOptions.window == null) {
            throw new Error('No window specified for Menu#popup, and there is no focused window');
        }
        const window = fullOptions.window;

        let location: [number, number] | null = null;
        if ((typeof fullOptions.x === 'number') && (typeof fullOptions.y === 'number')) {
            location = [fullOptions.x, fullOptions.y];
        }

        let nativeId: number = 0;
        bulkUISync(() => {
            const result = this.createNative_(MenuTypeCode.context, window);
            nativeId = result[0];
            const native = result[1];
            window['native_'].popupMenu(native, location, fullOptions.positioningItem!, () => {
                bulkUISync(() => {
                    this.destroyNative_(nativeId);
                });
                if (fullOptions.callback != null) {
                    fullOptions.callback();
                }
            });
        });
    }
    static setApplicationMenu(menu: Menu | null) {
        throw new Error('This method should have been overridden in the "app" module');
    }
    static getApplicationMenu(): Menu | null {
        throw new Error('This method should have been overridden in the "app" module');
    }
    static buildFromTemplate(template: Array<Partial<MenuItemConstructorOptions> | null>) {
        if (!Array.isArray(template)) {
            throw new TypeError('Menu.buildFromTemplate requires an array');
        }
        const newMenu = new Menu();
        for (const itemConstructorOptions of template) {
            if (itemConstructorOptions != null) {
                newMenu.append(new MenuItem(itemConstructorOptions));
            }
        }
        return newMenu;
    }

    getMenuItemById(id: string): MenuItem | null {
        for (const item of this.items) {
            if (item.id === id) {
                return item;
            }
            const submenuItem = item.submenu != null ? item.submenu.getMenuItemById(id) : null;
            if (submenuItem != null) {
                return submenuItem;
            }
        }
        return null;
    }

    /** @internal */
    private containsMenu_(menu: Menu): boolean {
        if (this === menu) {
            return true;
        }
        return this.items.some(item => item.submenu != null && item.submenu.containsMenu_(menu));
    }

    /** @internal */
    public attachAsSubmenu_(item: MenuItem): void {
        if (this.parentItem_ != null) {
            throw new Error('Menu is already attached as a submenu');
        }
        if (this.natives_.size !== 0) {
            throw new Error('A displayed menu cannot be attached as a submenu');
        }
        this.parentItem_ = item;
    }

    /** @internal */
    private updateRadioGroup_(item: MenuItem, forceChecked: boolean): void {
        const itemIndex = this.items.indexOf(item);
        let groupStart = itemIndex;
        let groupEnd = itemIndex;
        while (groupStart > 0 && this.items[groupStart - 1].type !== 'separator') {
            --groupStart;
        }
        while (groupEnd + 1 < this.items.length && this.items[groupEnd + 1].type !== 'separator') {
            ++groupEnd;
        }

        const group = this.items.slice(groupStart, groupEnd + 1).filter(groupItem => groupItem.type === 'radio');
        if (forceChecked || !group.some(groupItem => groupItem.checked)) {
            for (const groupItem of group) {
                groupItem['setChecked_'](groupItem === item);
            }
        }
    }

    /** @internal */
    public createNative_(type: number, window: BrowserWindow | null, theNativeId?: number): [number, MenuNative] {
        const nativeId = theNativeId || ++lastNativeId;
        //console.log(nativeId);

        const native = new MenuNative(type, this.nativeCallbacks_);
        this.natives_.set(nativeId, native);

        for (const item of this.items) {
            const nativeMenuItem = item['createNative_'](nativeId, window);
            native.append(nativeMenuItem);
        }

        return [nativeId, native];
    }
    /** @internal */
    public destroyNative_(nativeId: number): void {
        for (const item of this.items) {
            item['destroyNative_'](nativeId);
        }
        const native = this.natives_.get(nativeId)!;
        native.destroy();
        this.natives_.delete(nativeId);
    }

};

export class MenuItem {
    public readonly id: string;
    public readonly type: MenuItemType;
    public readonly role: Role | '';
    public menu: Menu | null = null;
    /** @internal */ private label_: string;
    /** @internal */ private enabled_: boolean;
    /** @internal */ private type_: number;
    public click: (item: MenuItem, window: BrowserWindow | null) => void;
    /** @internal */ private submenu_: Menu | null;
    /** @internal */ private natives_ = new Map<number, MenuItemNative>();
    /** @internal */ private checked_: boolean;
    /** @internal */ private accelerator_: string;
    /** @internal */ private acceleratorTokens_: string[];
    /** @internal */ private role_: string;
    /** @internal */ private checkedExplicit_: boolean;

    constructor(options: Partial<MenuItemConstructorOptions> = {}) {
        if (options.role != null) {
            const lowerCasedRole = options.role.toLowerCase() as Role;
            options = Object.assign({}, roleDefaults[lowerCasedRole], options);
            options.role = lowerCasedRole;
        }

        const fullOptions: MenuItemConstructorOptions = Object.assign({
            id: '',
            label: '',
            type: (options.submenu != null) ? 'submenu' : 'normal',
            checked: false,
            submenu: null,
            click: null,
            enabled: true,
            accelerator: '',
            role: ''
        }, options);

        if (fullOptions.submenu != null && !(fullOptions.submenu instanceof Menu)) {
            fullOptions.submenu = Menu.buildFromTemplate(fullOptions.submenu);
        }

        if (fullOptions.submenu == null && fullOptions.type === 'submenu') {
            fullOptions.submenu = new Menu();
        }

        if (!(fullOptions.type in MenuItemTypeCode)) {
            throw new TypeError(`Invalid menu item type: ${fullOptions.type}`);
        }
        if (fullOptions.submenu != null && fullOptions.type !== 'submenu') {
            throw new TypeError('Menu items with a submenu must have type "submenu"');
        }

        this.id = fullOptions.id;
        this.type = fullOptions.type;
        this.role = fullOptions.role;
        this.label_ = fullOptions.label;
        this.enabled_ = fullOptions.enabled;
        this.submenu_ = fullOptions.submenu as (Menu | null);
        this.type_ = MenuItemTypeCode[fullOptions.type];
        this.click = fullOptions.click as (item: MenuItem, window: BrowserWindow | null) => void;
        this.checked_ = fullOptions.checked;
        this.accelerator_ = fullOptions.accelerator;
        this.acceleratorTokens_ = parseAcceleratorToTokens(fullOptions.accelerator);
        this.role_ = fullOptions.role;
        this.checkedExplicit_ = options.checked != null;

        if (this.submenu_ != null) {
            this.submenu_.attachAsSubmenu_(this);
        }
    }

    get label(): string {
        return this.label_;
    }
    set label(value: string) {
        bulkUISync(() => {
            for (const native of this.natives_.values()) {
                native.setLabel(value);
            }
        });
        this.label_ = value;
    }
    get submenu(): Menu | null {
        return this.submenu_;
    }
    get enabled(): boolean {
        return this.enabled_;
    }
    set enabled(value: boolean) {
        bulkUISync(() => {
            for (const native of this.natives_.values()) {
                native.setEnabled(value);
            };
        });
        this.enabled_ = value;
    }
    get checked(): boolean {
        return this.checked_;
    }
    set checked(value: boolean) {
        if (this.type === 'radio' && value && this.menu != null) {
            this.menu['updateRadioGroup_'](this, true);
            return;
        }
        this.setChecked_(value);
    }
    get accelerator(): string {
        return this.accelerator_;
    }

    /** @internal */
    private setChecked_(value: boolean): void {
        bulkUISync(() => {
            for (const native of this.natives_.values()) {
                native.setChecked(value);
            }
        });
        this.checked_ = value;
    }

    /** @internal */
    private createNative_(nativeId: number, window: BrowserWindow | null): MenuItemNative {

        let nativeSubmenu: MenuNative | null = null;
        if (this.submenu_ != null) {
            [, nativeSubmenu] = this.submenu_['createNative_'](MenuItemTypeCode.submenu, window, nativeId);
        }

        const native = new MenuItemNative(this.role_, this.type_, nativeSubmenu, () => {
            if (this.type_ === MenuItemTypeCode.checkbox) {
                this.checked = !this.checked;
            }
            else if (this.type_ === MenuItemTypeCode.radio) {
                this.checked = true;
            }
            if (this.click != null) {
                this.click(this, window || globals.focusedBrowserWindow);
            }
        });

        native.setEnabled(this.enabled_);
        native.setLabel(this.label_);
        native.setChecked(this.checked_);

        native.setAccelerator(this.acceleratorTokens_);

        this.natives_.set(nativeId, native);

        return native;
    }

    /** @internal */
    private destroyNative_(nativeId: number): void {
        const native = this.natives_.get(nativeId)!;
        native.destroy();
        this.natives_.delete(nativeId);
        if (this.submenu_ != null) {
            this.submenu_['destroyNative_'](nativeId);
        }
    }
};
