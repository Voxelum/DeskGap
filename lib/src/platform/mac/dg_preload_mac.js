window.deskgap = {
    platform: 'darwin',
    postConsoleMessage: function (level, message) {
        window.webkit.messageHandlers.consoleMessage.postMessage(level + message);
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

window.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;

    var currentElement = e.target;
    while (currentElement != null) {
        if (currentElement.hasAttribute('data-deskgap-no-drag')) {
            break;
        }
        else if (currentElement.hasAttribute('data-deskgap-drag')) {
            window.webkit.messageHandlers.windowDrag.postMessage(null);
        }
        currentElement = currentElement.parentElement;
    }
});
