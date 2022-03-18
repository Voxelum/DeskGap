import { EventEmitter, IEventMap } from './internal/events';
import appPath from './internal/app-path';
import path = require('path');
import globals from './internal/globals';
import JSONTalk, { IServices, IServiceClient } from 'json-talk'
import { WebViewNative } from './internal/native';

const isWinRTEngineAvailable = process.platform === 'win32' && WebViewNative.isWinRTEngineAvailable();
const webview2Version = process.platform === 'win32' ? WebViewNative.getWebview2Version() : "";
type Engine = 'winrt' | 'trident' | 'webview2';

let defaultEngine: Engine | null = null;
if (process.platform === 'win32') {
    defaultEngine = webview2Version !== '' ? 'webview2' : isWinRTEngineAvailable ? 'winrt' : 'trident';
}

const engineCodeByName: Record<Engine, number> = {
    'trident': 0,
    'winrt': 1,
    'webview2': 2,
};

export interface WebViewEvents extends IEventMap {
    'did-finish-load': [];
    'page-title-updated': [string];
}

export interface WebPreferences {
    engine: Engine | null;
}

let currentId = 0;

export class WebView<Services extends IServices = any> extends EventEmitter<WebViewEvents> {
    /** @internal */ private id_: number;
    /** @internal */ private native_: WebViewNative;
    /** @internal */ private engine_: Engine | null;

    /** @internal */ private asyncNodeObjectsById_ = new Map<number, any>();
    /** @internal */ private asyncNodeValuesByName_ = new Map<string, any>();
    /** @internal */ private isDevToolsEnabled_: boolean = false;

    #jsonTalk: JSONTalk<Services>;
    #jsonTalkServices: IServices;

    constructor(
        callbacks: { onPageTitleUpdated: (title: string) => void, onReadyToShow: () => void },
        preferences: WebPreferences,
    ) {
        super();
        this.id_ = currentId;
        currentId++;

        this.engine_ = preferences.engine || defaultEngine;

        this.#jsonTalkServices = {};
        this.#jsonTalk = new JSONTalk<Services>((message) => {
            this.native_.executeJavaScript(`window.deskgap.__messageReceived(${JSON.stringify(message)})`, null);
        }, this.#jsonTalkServices);

        this.native_ = new WebViewNative({
            didFinishLoad: () => {
                if (this.isDestroyed()) return;
                try {
                    this.trigger_('did-finish-load');
                }
                finally {
                    callbacks.onReadyToShow();
                }
            },
            onStringMessage: (stringMessage: string) => {
                if (this.isDestroyed()) return;
                this.#jsonTalk.feedMessage(JSON.parse(stringMessage));
            },
            onPageTitleUpdated: (title: string) => {
                try {
                    if (this.isDestroyed()) return;
                    this.trigger_('page-title-updated', null, title);
                }
                finally {
                    callbacks.onPageTitleUpdated(title);
                }
            }
        }, this.engine_ == null ? null : engineCodeByName[this.engine_]);
    }

    publishServices(services: IServices) {
        Object.assign(this.#jsonTalkServices, services);
    }

    getService<ServiceName extends (keyof Services & string)>(serviceName: ServiceName): IServiceClient<Services[ServiceName]> {
        return this.#jsonTalk.connectService(serviceName)
    }

    get id(): number {
        return this.id_;
    }

    get engine(): Engine | null {
        return this.engine_;
    }

    isDestroyed(): boolean {
        return this.native_ == null;
    }

    loadFile(filePath: string): void {
        this.native_.loadLocalFile(path.resolve(appPath, filePath));
    }
    loadURL(url: string): void {
        const errorMessage = this.native_.loadRequest("GET", url, [], undefined);
        if (errorMessage != null) {
            throw new Error(errorMessage);
        }
    }

    setDevToolsEnabled(enabled: boolean): void {
        this.native_.setDevToolsEnabled(enabled);
        this.isDevToolsEnabled_ = enabled;
    }

    isDevToolsEnabled(): boolean {
        return this.isDevToolsEnabled_;
    }

    reload(): void {
        this.native_.reload();
    }
}

export const WebViews = {
    getAllWebViews(): WebView[] {
        return Array.from(globals.webViewsById.values());
    },

    /**
     * Alias to [[getAllWebViews]]
     */
    getAllWebContents(): WebView[] {
        return this.getAllWebViews();
    },

    /**
     * Alias to [[getFocusedWebView]]
     */
    getFocusedWebContents(): WebView | null {
        return this.getFocusedWebView();
    },
    getFocusedWebView(): WebView | null {

        if (globals.focusedBrowserWindow == null) {
            return null;
        }
        return globals.focusedBrowserWindow.webContents;
    },
    fromId(id: number): WebView | null {
        return globals.webViewsById.get(id) || null;
    },

    setDefaultEngine(engine: Engine): void {
        defaultEngine = engine;
    },

    getDefaultEngine(): Engine | null {
        return defaultEngine;
    },

    isEngineAvailable(engine: Engine): boolean {
        if (process.platform !== 'win32') {
            return false;
        }
        if (engine === 'trident') {
            return true;
        }
        if (engine === 'winrt') {
            return WebViewNative.isWinRTEngineAvailable();
        }
        return false;
    }
}
