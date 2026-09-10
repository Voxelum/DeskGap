import { app } from './app';
import { BrowserWindow } from './browser-window';
import { Menu, MenuItem } from './menu';
import { WebViews } from './webview';
import { Dialog } from './dialog';
import { Tray } from './tray';
import { shell } from './shell';
import { systemPreferences } from './system-preferences';
import { NativeTheme } from './native-theme';
import { nativeImage } from './native-image';
import { screen } from './screen';
import { clipboard } from './clipboard';
import { powerMonitor } from './power-monitor';
import { Session, session } from './session';
import { bridgeChannels, TransportChannel } from '../common/transport-channel';
import { Notification } from './notification';
import { credentials } from './credentials';
import { serializeUpdateManifestForSignature, Updater, updater } from './updater';
import { windowsAppInstaller } from './windows-app-installer';
import { windowsExecutable } from './windows-executable';
import { externalWindow } from './external-window';
import NativeException from './native-exception';

const deskgap = {
    app,
    BrowserWindow,
    webViews: WebViews,
    webContents: WebViews,
    Menu,
    MenuItem,
    systemPreferences,
    nativeTheme: new NativeTheme(systemPreferences),
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
    windowsExecutable,
    externalWindow,
    dialog: Dialog,
    Tray,
    NativeException,
    shell,
};

export = deskgap;
