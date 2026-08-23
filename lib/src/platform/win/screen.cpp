#include "screen.hpp"
#include "util/wstring_utf8.h"

#include <Windows.h>
#include <shellscalingapi.h>

namespace {
    DeskGap::Screen::Rectangle LogicalRectangle(const RECT& rectangle, UINT dpi) {
        return {
            MulDiv(rectangle.left, 96, dpi),
            MulDiv(rectangle.top, 96, dpi),
            MulDiv(rectangle.right - rectangle.left, 96, dpi),
            MulDiv(rectangle.bottom - rectangle.top, 96, dpi),
        };
    }
}

std::vector<DeskGap::Screen::Display> DeskGap::Screen::GetAllDisplays() {
    std::vector<Display> displays;
    EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
        auto& result = *reinterpret_cast<std::vector<Display>*>(data);
        MONITORINFOEXW monitorInfo { };
        monitorInfo.cbSize = sizeof(monitorInfo);
        if (!GetMonitorInfoW(monitor, &monitorInfo)) return TRUE;

        DISPLAY_DEVICEW device { };
        device.cb = sizeof(device);
        EnumDisplayDevicesW(monitorInfo.szDevice, 0, &device, 0);

        UINT dpiX = 96;
        UINT dpiY = 96;
        if (FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) {
            dpiX = 96;
        }

        result.push_back({
            static_cast<int64_t>(reinterpret_cast<intptr_t>(monitor)),
            device.DeviceString[0] == L'\0' ? WStringToUTF8(monitorInfo.szDevice) : WStringToUTF8(device.DeviceString),
            LogicalRectangle(monitorInfo.rcMonitor, dpiX),
            LogicalRectangle(monitorInfo.rcWork, dpiX),
            static_cast<double>(dpiX) / 96.0,
            (monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0,
        });
        return TRUE;
    }, reinterpret_cast<LPARAM>(&displays));
    return displays;
}
