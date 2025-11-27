window.deskgap = {
    platform: 'win32',
    postStringMessage: function (string) {
        window.chrome.webview.postMessage(string)
    },
    _filePaths: new WeakMap(),
    getPathForFile: function (file) {
        // Returns the file system path for a File object from drag-and-drop
        if (!file || !(file instanceof File)) {
            return '';
        }
        // Return cached path if available
        if (window.deskgap._filePaths.has(file)) {
            return window.deskgap._filePaths.get(file);
        }
        // Path not available - file needs to be processed via drop event first
        return '';
    },
    _setFilePathFromNative: function (index, path) {
        // Called from native code to set file paths after drop event processing
        if (window.deskgap._pendingDropFiles && window.deskgap._pendingDropFiles[index]) {
            window.deskgap._filePaths.set(window.deskgap._pendingDropFiles[index], path);
        }
    },
    _pendingDropFiles: null
}

// Intercept drop events to capture file paths
document.addEventListener('drop', function(e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        // Store files temporarily for path association
        window.deskgap._pendingDropFiles = Array.from(e.dataTransfer.files);
        // Post message with files to trigger native path extraction
        // The native code will call _setFilePathFromNative for each file
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessageWithAdditionalObjects) {
            window.chrome.webview.postMessageWithAdditionalObjects(
                'deskgap-file-drop',
                window.deskgap._pendingDropFiles
            );
        }
    }
}, true);

document.addEventListener('dragover', function(e) {
    // Allow drops by preventing default
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
    }
}, true);

document.addEventListener("DOMContentLoaded", function () {
    const style = document.createElement('style')
    document.head.appendChild(style)
    style.sheet.insertRule(`[data-deskgap-drag], [data-deskgap-drag] * {
        -webkit-app-region: drag;
    }`, 0)
    style.sheet.insertRule(`[data-deskgap-no-drag], [data-deskgap-no-drag] * {
        -webkit-app-region: no-drag;
    }`, 1)
    document.body.addEventListener('mousedown', evt => {
        if (evt.button !== 0) return;
        const { target } = evt;
        const appRegion = getComputedStyle(target)['-webkit-app-region'];

        if (appRegion === 'drag') {
            chrome.webview.hostObjects.sync.eventForwarder.drag;
            evt.preventDefault();
            evt.stopPropagation();
        }
    });
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
