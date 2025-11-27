window.deskgap = {
    platform: 'darwin',
    postStringMessage: function (string) {
        window.webkit.messageHandlers.stringMessage.postMessage(string);
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
        // Path not available
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
        // Notify native code to extract file paths
        var fileNames = window.deskgap._pendingDropFiles.map(function(f) { return f.name; });
        window.webkit.messageHandlers.fileDrop.postMessage(JSON.stringify(fileNames));
    }
}, true);

document.addEventListener('dragover', function(e) {
    // Allow drops by preventing default
    if (e.dataTransfer && e.dataTransfer.types && 
        (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.indexOf('Files') >= 0)) {
        e.preventDefault();
    }
}, true);

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
