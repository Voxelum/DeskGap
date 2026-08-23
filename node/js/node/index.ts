import './process';
import { enableCompileCache } from 'module';
import path = require('path');
import NativeException from './native-exception';
import { app } from './app';
import { BrowserWindow } from './browser-window';
import { Menu, MenuItem } from './menu';
import { WebViews } from './webview';
import { Dialog } from './dialog';
import { Tray } from './tray'
import { shell } from './shell';
import { systemPreferences } from './system-preferences';
import { NativeTheme } from './native-theme';
import { nativeImage } from './native-image';
import { screen } from './screen';
import { clipboard } from './clipboard';
import { powerMonitor } from './power-monitor';
import { Session, session } from './session';
import { registerModule } from './internal/cjs-intercept';
import { bridgeChannels, TransportChannel } from '../common/transport-channel';
import { Notification } from './notification';
import { configureCredentialScope, credentials } from './credentials';
import { serializeUpdateManifestForSignature, Updater, updater } from './updater';
import { windowsAppInstaller } from './windows-app-installer';
import { externalWindow } from './external-window';
import appInfo from './internal/app-info';

enableCompileCache(path.join(app.getPath('cache'), 'NodeCompileCache'));

const nativeTheme = new NativeTheme(systemPreferences);
configureCredentialScope(appInfo.id);

const deskgap = {
    app,
    BrowserWindow,
    webViews: WebViews,
    webContents: WebViews,
    Menu,
    MenuItem,
    systemPreferences,
    nativeTheme,
    nativeImage,
    screen,
    clipboard,
    powerMonitor,
    Session,
    session,
    TransportChannel,
    bridgeChannels,
    Notification,
    credentials,
    Updater,
    updater,
    serializeUpdateManifestForSignature,
    windowsAppInstaller,
    externalWindow,
    dialog: Dialog,
    Tray,
    NativeException,
    shell,
};

// export = deskgap;
registerModule(deskgap);

process.on('uncaughtException', (error) => {
    if (process.listeners('uncaughtException').length > 1) {
        return;
    }
    const message = error.stack || `${error.name}: ${error.message}`;
    console.error('Uncaught exception', message);
    Dialog.showErrorBox('Uncaught exception', message);
    process.exit(1);
});

app['run_']();

