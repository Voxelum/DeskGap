import './process';
import { enableCompileCache } from 'module';
import path = require('path');
import { app } from './app';
import { Dialog } from './dialog';
import { registerModule } from './internal/cjs-intercept';
import { configureCredentialScope } from './credentials';
import appInfo from './internal/app-info';
import deskgap = require('./api');

enableCompileCache(path.join(app.getPath('cache'), 'NodeCompileCache'));

configureCredentialScope(appInfo.id);

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
