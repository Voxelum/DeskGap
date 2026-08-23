#include "screen.hpp"

#include <gtk/gtk.h>

namespace {
    DeskGap::Screen::Rectangle RectangleFromGdk(const GdkRectangle& rectangle) {
        return { rectangle.x, rectangle.y, rectangle.width, rectangle.height };
    }
}

std::vector<DeskGap::Screen::Display> DeskGap::Screen::GetAllDisplays() {
#if GTK_CHECK_VERSION(3, 22, 0)
    GdkDisplay* display = gdk_display_get_default();
    if (display == nullptr) return {};

    GdkMonitor* primaryMonitor = gdk_display_get_primary_monitor(display);
    int monitorCount = gdk_display_get_n_monitors(display);
    std::vector<Display> displays;
    displays.reserve(monitorCount);
    for (int index = 0; index < monitorCount; ++index) {
        GdkMonitor* monitor = gdk_display_get_monitor(display, index);
        GdkRectangle bounds { };
        GdkRectangle workArea { };
        gdk_monitor_get_geometry(monitor, &bounds);
        gdk_monitor_get_workarea(monitor, &workArea);
        const char* model = gdk_monitor_get_model(monitor);
        displays.push_back({
            index,
            model == nullptr ? std::string() : model,
            RectangleFromGdk(bounds),
            RectangleFromGdk(workArea),
            static_cast<double>(gdk_monitor_get_scale_factor(monitor)),
            monitor == primaryMonitor,
        });
    }
    return displays;
#else
    GdkScreen* screen = gdk_screen_get_default();
    if (screen == nullptr) return {};

    int primaryMonitor = gdk_screen_get_primary_monitor(screen);
    int monitorCount = gdk_screen_get_n_monitors(screen);
    std::vector<Display> displays;
    displays.reserve(monitorCount);
    for (int index = 0; index < monitorCount; ++index) {
        GdkRectangle bounds { };
        GdkRectangle workArea { };
        gdk_screen_get_monitor_geometry(screen, index, &bounds);
        gdk_screen_get_monitor_workarea(screen, index, &workArea);
        displays.push_back({
            index,
            "",
            RectangleFromGdk(bounds),
            RectangleFromGdk(workArea),
            static_cast<double>(gdk_screen_get_monitor_scale_factor(screen, index)),
            index == primaryMonitor,
        });
    }
    return displays;
#endif
}
