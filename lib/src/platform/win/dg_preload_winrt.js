window.deskgap = {
    platform: 'win32',
    postStringMessage: function (string) {
        window.external.notify('m' + string);
    },
    _filePaths: new WeakMap(),
    getPathForFile: function (file) {
        // WinRT WebView does not support file path extraction
        // Returns empty string - file content can still be accessed via File API
        if (!file || !(file instanceof File)) {
            return '';
        }
        if (window.deskgap._filePaths.has(file)) {
            return window.deskgap._filePaths.get(file);
        }
        return '';
    },
    _setFilePathFromNative: function (index, path) {
        // Stub for compatibility - WinRT doesn't support this
    },
    _pendingDropFiles: null
}

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
