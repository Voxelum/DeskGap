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
    document.body.addEventListener('mousedown', evt => {
        if (evt.button !== 0) return;
        const { target } = evt;
        const resizeHandle = target.closest('[data-deskgap-resize]');
        if (resizeHandle != null) {
            window.chrome.webview.postMessage(
                'deskgap:window-resize:' + resizeHandle.getAttribute('data-deskgap-resize')
            );
            evt.preventDefault();
            evt.stopPropagation();
            return;
        }
        const appRegion = getComputedStyle(target)['-webkit-app-region'];

        if (appRegion === 'drag') {
            chrome.webview.postMessage('deskgap:window-drag');
            evt.preventDefault();
            evt.stopPropagation();
        }
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
