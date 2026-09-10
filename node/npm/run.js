const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = (distPath, entryPath, args) => {
    let executablePath;
    if (process.platform === 'darwin') {
        executablePath = path.join(distPath, 'DeskGap.app/Contents/MacOS/DeskGap');
    }
    else if (process.platform === 'win32') {
        executablePath = path.join(distPath, 'DeskGap/DeskGap.exe');
    }
    else if (process.platform === 'linux') {
        executablePath = path.join(distPath, 'DeskGap/DeskGap');
    }

    const deskgapProcess = spawn(path.resolve(executablePath), args, {
        stdio: 'inherit',
        windowsHide: false,
        env: {
            ...process.env,
            'DESKGAP_ENTRY': path.resolve(entryPath)
        }
    });

    const signalHandlers = new Map();
    for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => {
            if (!deskgapProcess.killed) {
                deskgapProcess.kill(signal);
            }
        };
        signalHandlers.set(signal, handler);
        process.on(signal, handler);
    }

    deskgapProcess.once('error', error => {
        console.error(error);
        process.exitCode = 1;
    });
    deskgapProcess.once('close', code => {
        for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
        process.exitCode = code == null ? 1 : code;
    });
    return deskgapProcess;
};
