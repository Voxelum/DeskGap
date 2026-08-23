#include "external_window.hpp"

#define NOMINMAX
#include <Windows.h>
#include <shellscalingapi.h>
#include <cmath>
#include <limits>

namespace {
    struct WindowSearch {
        DWORD processId;
        HWND window = nullptr;
    };

    BOOL CALLBACK FindWindow(HWND candidate, LPARAM parameter) {
        auto& search = *reinterpret_cast<WindowSearch*>(parameter);
        DWORD candidateProcessId = 0;
        GetWindowThreadProcessId(candidate, &candidateProcessId);
        if (candidateProcessId != search.processId || !IsWindowVisible(candidate)) {
            return TRUE;
        }
        search.window = candidate;
        return FALSE;
    }

    struct MonitorSearch {
        double logicalX;
        double logicalY;
        HMONITOR monitor = nullptr;
        RECT physicalBounds {};
        RECT logicalBounds {};
        UINT dpi = 96;
    };

    BOOL CALLBACK FindLogicalMonitor(HMONITOR monitor, HDC, LPRECT, LPARAM parameter) {
        auto& search = *reinterpret_cast<MonitorSearch*>(parameter);
        MONITORINFO info {};
        info.cbSize = sizeof(info);
        if (!GetMonitorInfoW(monitor, &info)) return TRUE;
        UINT dpiX = 96;
        UINT dpiY = 96;
        if (FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) dpiX = 96;
        RECT logical {
            MulDiv(info.rcMonitor.left, 96, dpiX),
            MulDiv(info.rcMonitor.top, 96, dpiX),
            MulDiv(info.rcMonitor.right, 96, dpiX),
            MulDiv(info.rcMonitor.bottom, 96, dpiX),
        };
        if (search.logicalX >= logical.left && search.logicalX < logical.right
            && search.logicalY >= logical.top && search.logicalY < logical.bottom) {
            search.monitor = monitor;
            search.physicalBounds = info.rcMonitor;
            search.logicalBounds = logical;
            search.dpi = dpiX;
            return FALSE;
        }
        return TRUE;
    }

    bool ToInteger(double value, int& result) {
        if (value < std::numeric_limits<int>::min() || value > std::numeric_limits<int>::max()) return false;
        result = static_cast<int>(std::round(value));
        return true;
    }
}

bool DeskGap::ExternalWindow::IsSupported() {
    return true;
}

DeskGap::ExternalWindow::Result DeskGap::ExternalWindow::TryMoveAndResize(
    uint32_t processId,
    const Bounds& bounds,
    bool dipCoordinates
) {
    WindowSearch search { processId };
    SetLastError(ERROR_SUCCESS);
    if (!EnumWindows(FindWindow, reinterpret_cast<LPARAM>(&search))) {
        const DWORD error = GetLastError();
        if (search.window == nullptr && error != ERROR_SUCCESS) return { Status::FAILED, error, "EnumWindows failed" };
    }
    if (search.window == nullptr) return { Status::NOT_FOUND };

    int x;
    int y;
    int width;
    int height;
    if (!ToInteger(bounds.x, x) || !ToInteger(bounds.y, y)
        || !ToInteger(bounds.width, width) || !ToInteger(bounds.height, height)) {
        return { Status::FAILED, ERROR_ARITHMETIC_OVERFLOW, "External window bounds exceed Win32 limits" };
    }

    if (dipCoordinates) {
        MonitorSearch monitorSearch { bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 };
        EnumDisplayMonitors(nullptr, nullptr, FindLogicalMonitor, reinterpret_cast<LPARAM>(&monitorSearch));
        if (monitorSearch.monitor == nullptr) {
            monitorSearch.monitor = MonitorFromWindow(search.window, MONITOR_DEFAULTTONEAREST);
            MONITORINFO info {};
            info.cbSize = sizeof(info);
            if (!GetMonitorInfoW(monitorSearch.monitor, &info)) return { Status::FAILED, GetLastError(), "GetMonitorInfo failed" };
            UINT dpiY = 96;
            if (FAILED(GetDpiForMonitor(monitorSearch.monitor, MDT_EFFECTIVE_DPI, &monitorSearch.dpi, &dpiY))) monitorSearch.dpi = 96;
            monitorSearch.physicalBounds = info.rcMonitor;
            monitorSearch.logicalBounds = {
                MulDiv(info.rcMonitor.left, 96, monitorSearch.dpi),
                MulDiv(info.rcMonitor.top, 96, monitorSearch.dpi),
                MulDiv(info.rcMonitor.right, 96, monitorSearch.dpi),
                MulDiv(info.rcMonitor.bottom, 96, monitorSearch.dpi),
            };
        }
        x = monitorSearch.physicalBounds.left + MulDiv(x - monitorSearch.logicalBounds.left, monitorSearch.dpi, 96);
        y = monitorSearch.physicalBounds.top + MulDiv(y - monitorSearch.logicalBounds.top, monitorSearch.dpi, 96);
        width = MulDiv(width, monitorSearch.dpi, 96);
        height = MulDiv(height, monitorSearch.dpi, 96);
    }

    constexpr UINT flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW;
    if (!SetWindowPos(search.window, nullptr, x, y, width, height, flags)) {
        return { Status::FAILED, GetLastError(), "SetWindowPos failed" };
    }
    return { Status::SUCCESS };
}