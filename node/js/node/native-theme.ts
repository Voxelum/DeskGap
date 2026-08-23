import { EventEmitter } from 'events';
import { systemPreferencesNative } from './internal/native';

export type ThemeSource = 'system' | 'light' | 'dark';

export interface DarkModeSource {
    isDarkMode(): boolean;
    on(eventName: 'dark-mode-toggled', listener: (...args: any[]) => void): unknown;
}

export interface NativeThemeBackend {
    getThemeSource(): number;
    setThemeSource(source: number): void;
    shouldUseDarkColors(): boolean;
}

export class NativeTheme extends EventEmitter {
    constructor(
        private readonly darkModeSource_: DarkModeSource,
        private readonly backend_: NativeThemeBackend = systemPreferencesNative
    ) {
        super();
        darkModeSource_.on('dark-mode-toggled', () => {
            if (this.themeSource === 'system') {
                this.emit('updated');
            }
        });
    }

    get shouldUseDarkColors(): boolean {
        return this.backend_.shouldUseDarkColors();
    }

    get shouldUseHighContrastColors(): boolean {
        return false;
    }

    get shouldUseInvertedColorScheme(): boolean {
        return false;
    }

    get themeSource(): ThemeSource {
        return ['system', 'light', 'dark'][this.backend_.getThemeSource()] as ThemeSource;
    }

    set themeSource(themeSource: ThemeSource) {
        if (themeSource !== 'system' && themeSource !== 'light' && themeSource !== 'dark') {
            throw new TypeError(`Invalid theme source: ${themeSource}`);
        }
        if (themeSource === this.themeSource) return;

        this.backend_.setThemeSource({ system: 0, light: 1, dark: 2 }[themeSource]);
        this.emit('updated');
    }
}