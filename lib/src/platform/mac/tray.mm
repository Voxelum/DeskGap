#import <Cocoa/Cocoa.h>

#include <algorithm>
#include "menu_impl.h"
#include "tray.hpp"

namespace DeskGap {
    struct Tray::Impl;
}

@interface DeskGapTrayTarget: NSObject
@property(nonatomic, assign) DeskGap::Tray::Impl* implementation;
-(void)handleAction: (id)sender;
@end

namespace DeskGap {
    struct Tray::Impl {
        NSStatusItem* statusItem;
        DeskGapTrayTarget* target;
        EventCallbacks callbacks;
        std::string title;

        explicit Impl(EventCallbacks&& eventCallbacks)
            : statusItem([[NSStatusBar systemStatusBar] statusItemWithLength: NSSquareStatusItemLength]),
              target([DeskGapTrayTarget new]),
              callbacks(std::move(eventCallbacks)) {
            target.implementation = this;
            statusItem.button.target = target;
            statusItem.button.action = @selector(handleAction:);
            [statusItem.button sendActionOn: NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];
        }

        ~Impl() {
            target.implementation = nullptr;
            [[NSStatusBar systemStatusBar] removeStatusItem: statusItem];
        }
    };

    namespace {
        NSImage* ImageFrom(const NativeImage& image) {
            const NativeImage::Representation* representation = image.GetRepresentation();
            if (representation == nullptr) return nil;

            NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc]
                initWithBitmapDataPlanes: nullptr
                pixelsWide: representation->pixelWidth
                pixelsHigh: representation->pixelHeight
                bitsPerSample: 8
                samplesPerPixel: 4
                hasAlpha: YES
                isPlanar: NO
                colorSpaceName: NSDeviceRGBColorSpace
                bytesPerRow: representation->pixelWidth * 4
                bitsPerPixel: 32
            ];
            if (bitmap == nil) return nil;
            std::copy(
                representation->pixels.begin(),
                representation->pixels.end(),
                [bitmap bitmapData]
            );
            NSImage* result = [[NSImage alloc] initWithSize: NSMakeSize(
                representation->pixelWidth / representation->scaleFactor,
                representation->pixelHeight / representation->scaleFactor
            )];
            [result addRepresentation: bitmap];
            return result;
        }
    }

    Tray::Tray(const NativeImage& image, const EventCallbacks&& callbacks)
        : impl_(new Impl(EventCallbacks(callbacks))) {
        SetImage(image);
    }

    Tray::~Tray() { Destroy(); }

    void Tray::Destroy() {
        delete impl_;
        impl_ = nullptr;
    }

    bool Tray::isDestroyed() { return impl_ == nullptr; }

    void Tray::SetImage(const NativeImage& image) {
        if (impl_ != nullptr) impl_->statusItem.button.image = ImageFrom(image);
    }

    void Tray::PopupMenu(const Menu& menu, const std::array<int, 2>*, int, std::function<void()>&& onClose) {
        if (impl_ == nullptr) return;
        [impl_->statusItem popUpStatusItemMenu: menu.impl_->ns_menu];
        onClose();
    }

    void Tray::SetTooltip(const std::string& tooltip) {
        if (impl_ != nullptr) impl_->statusItem.button.toolTip = [NSString stringWithUTF8String: tooltip.c_str()];
    }

    void Tray::SetTitle(const std::string& title) {
        if (impl_ == nullptr) return;
        impl_->title = title;
        impl_->statusItem.button.title = [NSString stringWithUTF8String: title.c_str()];
    }

    std::string Tray::GetTitle() {
        return impl_ == nullptr ? "" : impl_->title;
    }
}

@implementation DeskGapTrayTarget
-(void)handleAction: (id)sender {
    if (_implementation == nullptr) return;
    NSEvent* event = [NSApp currentEvent];
    if (event.type == NSEventTypeRightMouseUp) {
        _implementation->callbacks.onRightClick();
    }
    else if (event.clickCount >= 2) {
        _implementation->callbacks.onDoubleClick();
    }
    else {
        _implementation->callbacks.onClick();
    }
}
@end