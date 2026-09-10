// EdgeHTML exposes EventTarget but does not allow constructing it. A DOM-backed
// target preserves native dispatch semantics, including target, once and capture.
try {
    new EventTarget();
}
catch (_) {
    const nativePrototype = EventTarget.prototype;
    interface DOMEventTarget extends EventTarget {}
    class DOMEventTarget {
        constructor() {
            return Object.setPrototypeOf(document.createDocumentFragment(), new.target.prototype);
        }
    }
    Object.setPrototypeOf(DOMEventTarget.prototype, nativePrototype);
    Object.setPrototypeOf(DOMEventTarget, EventTarget);
    window.EventTarget = DOMEventTarget;
}
