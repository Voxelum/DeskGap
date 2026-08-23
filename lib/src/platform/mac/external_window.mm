#include "external_window.hpp"

#import <ApplicationServices/ApplicationServices.h>
#include <chrono>
#include <thread>

namespace {
    class CFReference {
    public:
        explicit CFReference(CFTypeRef value = nullptr): value_(value) {}
        CFReference(const CFReference&) = delete;
        CFReference& operator=(const CFReference&) = delete;
        ~CFReference() { if (value_ != nullptr) CFRelease(value_); }

        CFTypeRef Get() const { return value_; }

    private:
        CFTypeRef value_;
    };

    DeskGap::ExternalWindow::Result Failure(AXError error, const char* operation) {
        std::string message = operation;
        if (error == kAXErrorAPIDisabled || !AXIsProcessTrusted()) {
            message += ": Accessibility permission is required";
        }
        return { DeskGap::ExternalWindow::Status::FAILED, error, std::move(message) };
    }
}

bool DeskGap::ExternalWindow::IsSupported() {
    return true;
}

DeskGap::ExternalWindow::Result DeskGap::ExternalWindow::TryMoveAndResize(
    uint32_t processId,
    const Bounds& bounds,
    bool
) {
    CFReference application(AXUIElementCreateApplication(static_cast<pid_t>(processId)));
    if (application.Get() == nullptr) return { Status::NOT_FOUND };

    CFTypeRef windowsValue = nullptr;
    AXError error = AXUIElementCopyAttributeValue(
        static_cast<AXUIElementRef>(const_cast<void*>(application.Get())),
        kAXWindowsAttribute,
        &windowsValue
    );
    CFReference windows(windowsValue);
    if (error == kAXErrorCannotComplete || error == kAXErrorInvalidUIElement) return { Status::NOT_FOUND };
    if (error != kAXErrorSuccess) return Failure(error, "Cannot enumerate the external application windows");
    if (windows.Get() == nullptr || CFGetTypeID(windows.Get()) != CFArrayGetTypeID()
        || CFArrayGetCount(static_cast<CFArrayRef>(windows.Get())) == 0) {
        return { Status::NOT_FOUND };
    }

    auto window = static_cast<AXUIElementRef>(const_cast<void*>(
        CFArrayGetValueAtIndex(static_cast<CFArrayRef>(windows.Get()), 0)
    ));
    CFTypeRef fullscreenValue = nullptr;
    bool wasFullscreen = false;
    if (AXUIElementCopyAttributeValue(window, kAXFullScreenAttribute, &fullscreenValue) == kAXErrorSuccess) {
        CFReference fullscreen(fullscreenValue);
        if (fullscreen.Get() != nullptr && CFGetTypeID(fullscreen.Get()) == CFBooleanGetTypeID()) {
            wasFullscreen = CFBooleanGetValue(static_cast<CFBooleanRef>(fullscreen.Get()));
        }
    }
    if (wasFullscreen) {
        AXUIElementSetAttributeValue(window, kAXFullScreenAttribute, kCFBooleanFalse);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    CGPoint position { bounds.x, bounds.y };
    CGSize size { bounds.width, bounds.height };
    CFReference positionValue(AXValueCreate(kAXValueCGPointType, &position));
    CFReference sizeValue(AXValueCreate(kAXValueCGSizeType, &size));
    error = AXUIElementSetAttributeValue(window, kAXPositionAttribute, positionValue.Get());
    if (error == kAXErrorSuccess) error = AXUIElementSetAttributeValue(window, kAXSizeAttribute, sizeValue.Get());
    if (wasFullscreen) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        AXUIElementSetAttributeValue(window, kAXFullScreenAttribute, kCFBooleanTrue);
    }
    if (error != kAXErrorSuccess) return Failure(error, "Cannot move the external application window");
    return { Status::SUCCESS };
}