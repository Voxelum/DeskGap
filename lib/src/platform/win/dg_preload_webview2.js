window.deskgap = {
    platform: 'win32',
    postStringMessage: function (string) {
        window.chrome.webview.postMessage(string)
    }
}

// window.addEventListener('mousedown', function(e) {
//     if (e.button !== 0) return;

//     var currentElement = e.target;
//     while (currentElement != null) {
//         if (currentElement.hasAttribute('data-deskgap-no-drag')) {
//             break;
//         }
//         else if (currentElement.hasAttribute('data-deskgap-drag')) {
//             window.setImmediate(function() {
//                 window.external.notify('d')
//             });
//             break;
//         }
//         currentElement = currentElement.parentElement;
//     }
// });

document.addEventListener("DOMContentLoaded", function () {
    // window.external.notify("t" + document.title);
    // new MutationObserver(function () {
    //     window.external.notify("t" + document.title);
    // }).observe(
    //     document.querySelector('title'),
    //     { characterData: true, childList: true }
    // );
    document.body.addEventListener('mousedown', evt => {
        if (evt.button !== 0) return;
        const { target } = evt;
        const appRegion = getComputedStyle(target)['-webkit-app-region'];

        if (appRegion === 'drag') {
            chrome.webview.hostObjects.sync.eventForwarder.MouseDownDrag();
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
