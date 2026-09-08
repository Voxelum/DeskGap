window.deskgap = {
    platform: 'win32',
    postConsoleMessage: function (level, message) {
        window.chrome.webview.postMessage('deskgap:console:' + level + message)
    }
}

;(function () {
    const postConsoleMessage = window.deskgap.postConsoleMessage
    const codes = { debug: 'd', log: 'i', info: 'i', warn: 'w', error: 'e' }
    const format = value => typeof value === 'string' ? value : (() => {
        try { return JSON.stringify(value) }
        catch (_) { return String(value) }
    })()
    for (const name of Object.keys(codes)) {
        const original = console[name]
        console[name] = function (...args) {
            try { postConsoleMessage(codes[name], args.map(format).join(' ')) } catch (_) {}
            return original.apply(this, args)
        }
    }
})()

document.addEventListener("DOMContentLoaded", function () {
    let pendingNativeResize = null;
    let pendingNativeDrag = null;

    function getAppRegion(target) {
        let element = target instanceof Element ? target : target.parentElement;
        while (element != null) {
            const region = getComputedStyle(element)['-webkit-app-region'];
            if (region === 'drag' || region === 'no-drag') return region;
            element = element.parentElement;
        }
        return 'none';
    }

    const style = document.createElement('style')
    document.head.appendChild(style)
    style.sheet.insertRule(`[data-deskgap-drag], [data-deskgap-drag] * {
        -webkit-app-region: drag;
    }`, 0)
    style.sheet.insertRule(`[data-deskgap-no-drag], [data-deskgap-no-drag] * {
        -webkit-app-region: no-drag;
    }`, 1)
    style.sheet.insertRule(`[data-deskgap-resize] {
        -webkit-app-region: no-drag;
    }`, 2)
    style.sheet.insertRule(`[data-deskgap-native-resize] {
        position: fixed;
        top: 0;
        height: 6px;
        z-index: 2147483647;
    }`, 3)
    style.sheet.insertRule(`[data-deskgap-native-resize="top"] {
        left: 12px;
        right: 12px;
        cursor: ns-resize;
    }`, 4)
    style.sheet.insertRule(`[data-deskgap-native-resize="top-left"] {
        left: 0;
        width: 12px;
        cursor: nwse-resize;
    }`, 5)
    style.sheet.insertRule(`[data-deskgap-native-resize="top-right"] {
        right: 0;
        width: 12px;
        cursor: nesw-resize;
    }`, 6)
    for (const edge of ['top-left', 'top', 'top-right']) {
        const handle = document.createElement('div');
        handle.setAttribute('data-deskgap-native-resize', edge);
        handle.setAttribute('data-deskgap-resize', edge);
        document.body.appendChild(handle);
    }
    document.body.addEventListener('mousedown', evt => {
        if (evt.button !== 0) return;
        const { target } = evt;
        const resizeHandle = target.closest('[data-deskgap-resize]');
        if (resizeHandle != null) {
            if (resizeHandle.hasAttribute('data-deskgap-native-resize')) {
                pendingNativeResize = {
                    edge: resizeHandle.getAttribute('data-deskgap-resize'),
                    x: evt.screenX,
                    y: evt.screenY,
                };
            } else {
                window.chrome.webview.postMessage(
                    'deskgap:window-resize:' + resizeHandle.getAttribute('data-deskgap-resize')
                );
            }
            evt.preventDefault();
            evt.stopPropagation();
            return;
        }
        const appRegion = getAppRegion(target);

        if (appRegion === 'drag') {
            pendingNativeDrag = {
                x: evt.screenX,
                y: evt.screenY,
            };
        }
    });
    window.addEventListener('mousemove', evt => {
        if ((evt.buttons & 1) === 0) {
            pendingNativeResize = null;
            pendingNativeDrag = null;
            return;
        }
        if (pendingNativeResize != null) {
            if (Math.abs(evt.screenX - pendingNativeResize.x) < 3
                && Math.abs(evt.screenY - pendingNativeResize.y) < 3) return;
            const { edge } = pendingNativeResize;
            pendingNativeResize = null;
            window.chrome.webview.postMessage('deskgap:window-resize:' + edge);
        } else if (pendingNativeDrag != null) {
            if (Math.abs(evt.screenX - pendingNativeDrag.x) < 3
                && Math.abs(evt.screenY - pendingNativeDrag.y) < 3) return;
            pendingNativeDrag = null;
            window.chrome.webview.postMessage('deskgap:window-drag');
        } else {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();
    }, true);
    window.addEventListener('mouseup', evt => {
        if (evt.button === 0) {
            pendingNativeResize = null;
            pendingNativeDrag = null;
        }
    }, true);
    document.body.addEventListener('dblclick', evt => {
        if (evt.button !== 0) return;
        if (evt.target.closest('[data-deskgap-native-resize]') != null) {
            window.chrome.webview.postMessage('deskgap:window-control:toggle-maximize');
            evt.preventDefault();
            evt.stopPropagation();
            return;
        }
        if (getAppRegion(evt.target) !== 'drag') return;
        window.chrome.webview.postMessage('deskgap:window-control:toggle-maximize');
        evt.preventDefault();
        evt.stopPropagation();
    });
    document.body.addEventListener('click', evt => {
        const windowControl = evt.target.closest('[data-deskgap-window-control]');
        if (windowControl == null) return;
        window.chrome.webview.postMessage(
            'deskgap:window-control:' + windowControl.getAttribute('data-deskgap-window-control')
        );
        evt.preventDefault();
        evt.stopPropagation();
    });
});

window.addEventListener('drop', function (event) {
    if (typeof window.chrome.webview.postMessageWithAdditionalObjects !== 'function') return;
    window.chrome.webview.postMessageWithAdditionalObjects(
        'deskgap:files-dropped',
        event.dataTransfer.files
    );
}, true);


window.addEventListener('keydown', function(e) {
    if ((e.keyCode === 187 || e.keyCode === 189) && e.ctrlKey === true) {
        //Preventing ctrl+(+|-) zooming;
        e.preventDefault();
    }
});
window.addEventListener('wheel', function(e) {
    if (e.ctrlKey === true) {
        //Preventing ctrl-scroll zooming
        e.preventDefault();
    }
});
