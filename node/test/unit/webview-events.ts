import { WebView } from '../../../tsd/node/webview';

function checkFilesDroppedEvent(webView: WebView): void {
    webView.on('files-dropped', (_event, paths) => {
        const droppedPaths: string[] = paths;
        void droppedPaths;
    });

    webView.on('will-navigate', (event, url) => {
        const target: string = url;
        if (target.startsWith('https://external.example')) event.preventDefault();
    });

    webView.on('render-process-gone', (_event, details) => {
        const reason: string = details.reason;
        const exitCode: number = details.exitCode;
        void reason;
        void exitCode;
    });

    webView.on('console-message', event => {
        const level: 'debug' | 'info' | 'warning' | 'error' = event.level;
        const message: string = event.message;
        void level;
        void message;
    });

    webView.setWindowOpenHandler(details => ({
        action: details.frameName === 'app' ? 'allow' : 'deny',
        overrideBrowserWindowOptions: { show: false },
    }));

    const requestId: number = webView.findInPage('launcher', { matchCase: false });
    webView.stopFindInPage('clearSelection');
    webView.openDevTools();
    webView.closeDevTools();
    const supportsDrop: boolean = webView.supportsNativeFileDrop;
    void supportsDrop;
    const devToolsOpened: boolean = webView.isDevToolsOpened();
    void requestId;
    void devToolsOpened;
}

void checkFilesDroppedEvent;