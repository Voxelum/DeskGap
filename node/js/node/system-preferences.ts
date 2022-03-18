import { EventEmitter, IEventMap } from './internal/events';
import { systemPreferencesNative as native } from './internal/native';

export interface UserDefaultTypes {
    'string': string;
    'array': any[];
    'dictionary': object;
    'boolean': boolean;
    'integer': number;
    'float': number;
    'double': number;
    'url': string
}

const userDefaultGetters = {
    'string': native.getUserDefaultString,
    'array': native.getUserDefaultArrayJSON,
    'dictionary': native.getUserDefaultDictionaryJSON,
    'boolean': native.getUserDefaultBool,
    'integer': native.getUserDefaultInteger,
    'float': native.getUserDefaultFloat,
    'double': native.getUserDefaultDouble,
    'url': native.getUserDefaultURL
};

export interface SystemPreferenceEvents extends IEventMap {
    'dark-mode-toggled': []
}

export class SystemPreference extends EventEmitter<SystemPreferenceEvents> {
    /** @internal */ private isDarkMode_: boolean;
    constructor() {
        super();
        this.isDarkMode_ = native.getAndWatchDarkMode(() => {
            this.isDarkMode_ = !this.isDarkMode_;
            this.trigger_('dark-mode-toggled');
        });
    }
    getUserDefault<K extends keyof UserDefaultTypes>(key: string, type: K): UserDefaultTypes[K]  {
        const result = userDefaultGetters[type](key);
        if (type === 'array' || type === 'dictionary') {
            return JSON.parse(result as any);
        }
        else {
            return result as any;
        }
    }
    isDarkMode(): boolean {
        return this.isDarkMode_;
    }
}

export const systemPreferences = new SystemPreference();

