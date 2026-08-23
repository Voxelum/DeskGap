#import <AppKit/AppKit.h>

#include "screen.hpp"
#include "util/string_convert.h"
#include <cmath>

namespace {
    DeskGap::Screen::Rectangle RectangleFromFrame(NSRect frame, CGFloat primaryTop) {
        return {
            static_cast<int>(std::round(NSMinX(frame))),
            static_cast<int>(std::round(primaryTop - NSMaxY(frame))),
            static_cast<int>(std::round(NSWidth(frame))),
            static_cast<int>(std::round(NSHeight(frame))),
        };
    }
}

std::vector<DeskGap::Screen::Display> DeskGap::Screen::GetAllDisplays() {
    NSArray<NSScreen*>* screens = [NSScreen screens];
    std::vector<Display> displays;
    displays.reserve(screens.count);
    CGFloat primaryTop = screens.count == 0 ? 0 : NSMaxY(screens[0].frame);

    for (NSUInteger index = 0; index < screens.count; ++index) {
        NSScreen* screen = screens[index];
        NSNumber* screenNumber = screen.deviceDescription[@"NSScreenNumber"];
        std::string label;
        if (@available(macOS 10.15, *)) {
            label = CXXStr(screen.localizedName);
        }
        displays.push_back({
            screenNumber.longLongValue,
            std::move(label),
            RectangleFromFrame(screen.frame, primaryTop),
            RectangleFromFrame(screen.visibleFrame, primaryTop),
            screen.backingScaleFactor,
            index == 0,
        });
    }
    return displays;
}
