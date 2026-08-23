window.deskgap = {
    platform: 'win32',
    postConsoleMessage: function (level, message) {
        window.external.notify('c' + level + message);
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
            window.setImmediate(function() {
                window.external.notify('d')
            });
            break;
        }
        currentElement = currentElement.parentElement;
    }
});

document.addEventListener("DOMContentLoaded", function () {
    window.external.notify("t" + document.title);
    new MutationObserver(function () {
        window.external.notify("t" + document.title);
    }).observe(
        document.querySelector('title'),
        { characterData: true, childList: true }
    );
});


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
