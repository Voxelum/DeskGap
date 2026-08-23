#include <Windows.h>

#include "menu_impl.h"
#include "webview_impl.h"
#include "./BrowserWindow_impl.h"
#include "./util/wstring_utf8.h"
#include "./util/win32_check.h"
#include "./util/dpi.h"
#include "./util/win_version.h"
#include "util/ui_theme_host.hpp"
#include "window_messages.h"
#include <gdiplus.h>
#include <cstring>
#include <dwmapi.h>

namespace {
	const wchar_t* const BrowserWindowWndClassName = L"DeskGapBrowserWindow";

    int ResizeBorderWidth(HWND window) {
        const UINT dpi = GetDpiForWindow(window);
        return GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi)
            + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
    }

    int SizingEdgeForHitTest(WPARAM hitTest) {
        switch (hitTest) {
        case HTLEFT: return WMSZ_LEFT;
        case HTRIGHT: return WMSZ_RIGHT;
        case HTTOP: return WMSZ_TOP;
        case HTTOPLEFT: return WMSZ_TOPLEFT;
        case HTTOPRIGHT: return WMSZ_TOPRIGHT;
        case HTBOTTOM: return WMSZ_BOTTOM;
        case HTBOTTOMLEFT: return WMSZ_BOTTOMLEFT;
        case HTBOTTOMRIGHT: return WMSZ_BOTTOMRIGHT;
        default: return 0;
        }
    }

    LRESULT HitTestAtCursor(HWND window) {
        POINT cursor { };
        GetCursorPos(&cursor);
        return SendMessageW(
            window,
            WM_NCHITTEST,
            0,
            MAKELPARAM(static_cast<short>(cursor.x), static_cast<short>(cursor.y))
        );
    }
}

namespace DeskGap {
    extern std::unique_ptr<UXThemeHost> theme_host_;

    BrowserWindow::Impl::Impl(const WebView& webView, EventCallbacks& callbacks): webView(webView), callbacks(std::move(callbacks)) {
    }

    BrowserWindow::BrowserWindow(const WebView& webView, EventCallbacks&& callbacks): impl_(std::make_unique<Impl>(webView, callbacks)) {
        static bool isClassRegistered = false;
        if (!isClassRegistered) {
            isClassRegistered = true;
            WNDCLASSEXW wndClass { };
            wndClass.cbSize = sizeof(WNDCLASSEXW);
            wndClass.hInstance = GetModuleHandleW(nullptr);
            wndClass.lpszClassName = BrowserWindowWndClassName;
            wndClass.lpfnWndProc = [](HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) -> LRESULT {
                BrowserWindow* browserWindow = reinterpret_cast<BrowserWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
                if (browserWindow != nullptr) {
                    switch (msg)
                    {
                        case WM_ACTIVATE: {
                            if (wp == WA_INACTIVE) {
                                browserWindow->impl_->callbacks.onBlur();
                            }
                            else {
                                browserWindow->impl_->callbacks.onFocus();
                            }

                            if (LOWORD(wp) == WA_ACTIVE || LOWORD(wp) == WA_CLICKACTIVE)
                            {
                                browserWindow->impl_->active = true;
                            }
                            else if (LOWORD(wp) == WA_INACTIVE)
                            {
                                browserWindow->impl_->active = false;
                                if (browserWindow->impl_->autoHideMenuBar) {
                                    browserWindow->SetMenuBarVisibility(false);
                                }
                            }
                            break;
                        }
                        case WM_SYSKEYDOWN: {
                            if (wp == VK_MENU && browserWindow->impl_->autoHideMenuBar) {
                                browserWindow->SetMenuBarVisibility(true);
                            }
                            break;
                        }
                        case WM_CLOSE: {
                            browserWindow->impl_->callbacks.onClose();
                            return 0;
                        }
                        case WindowControlMessage: {
                            switch (static_cast<WindowControlAction>(wp)) {
                            case WindowControlAction::Minimize:
                                ShowWindow(hwnd, SW_MINIMIZE);
                                break;
                            case WindowControlAction::ToggleMaximize:
                                ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
                                break;
                            case WindowControlAction::Close:
                                PostMessageW(hwnd, WM_CLOSE, 0, 0);
                                break;
                            }
                            return 0;
                        }
                        case WM_NCHITTEST: {
                            if (!browserWindow->impl_->hasFrame
                                && !IsZoomed(hwnd)
                                && (GetWindowLongW(hwnd, GWL_STYLE) & WS_THICKFRAME) != 0) {
                                RECT windowRect { };
                                GetWindowRect(hwnd, &windowRect);
                                const int resizeBorder = ResizeBorderWidth(hwnd);
                                const int resizeCorner = resizeBorder * 2
                                    + GetSystemMetricsForDpi(SM_CXBORDER, GetDpiForWindow(hwnd));
                                const POINT cursor {
                                    static_cast<short>(LOWORD(lp)),
                                    static_cast<short>(HIWORD(lp)),
                                };
                                const bool left = cursor.x >= windowRect.left
                                    && cursor.x < windowRect.left + resizeBorder;
                                const bool right = cursor.x < windowRect.right
                                    && cursor.x >= windowRect.right - resizeBorder;
                                const bool top = cursor.y >= windowRect.top
                                    && cursor.y < windowRect.top + resizeBorder;
                                const bool bottom = cursor.y < windowRect.bottom
                                    && cursor.y >= windowRect.bottom - resizeBorder;

                                const bool cornerLeft = cursor.x < windowRect.left + resizeCorner;
                                const bool cornerRight = cursor.x >= windowRect.right - resizeCorner;
                                const bool cornerTop = cursor.y < windowRect.top + resizeCorner;
                                const bool cornerBottom = cursor.y >= windowRect.bottom - resizeCorner;
                                if (top && cornerLeft) return HTTOPLEFT;
                                if (top && cornerRight) return HTTOPRIGHT;
                                if (bottom && cornerLeft) return HTBOTTOMLEFT;
                                if (bottom && cornerRight) return HTBOTTOMRIGHT;
                                if (left && cornerTop) return HTTOPLEFT;
                                if (left && cornerBottom) return HTBOTTOMLEFT;
                                if (right && cornerTop) return HTTOPRIGHT;
                                if (right && cornerBottom) return HTBOTTOMRIGHT;
                                if (left) return HTLEFT;
                                if (right) return HTRIGHT;
                                if (top) return HTTOP;
                                if (bottom) return HTBOTTOM;
                            }
                            break;
                        }
                        case WM_NCLBUTTONDOWN: {
                            if (!browserWindow->impl_->hasFrame
                                && !IsZoomed(hwnd)
                                && (GetWindowLongW(hwnd, GWL_STYLE) & WS_THICKFRAME) != 0) {
                                int sizingEdge = SizingEdgeForHitTest(wp);
                                if (sizingEdge != 0) {
                                    ReleaseCapture();
                                    SendMessageW(hwnd, WM_SYSCOMMAND, SC_SIZE + sizingEdge, lp);
                                    return 0;
                                }
                            }
                            break;
                        }
                        case WM_LBUTTONDOWN: {
                            if (!browserWindow->impl_->hasFrame
                                && !IsZoomed(hwnd)
                                && (GetWindowLongW(hwnd, GWL_STYLE) & WS_THICKFRAME) != 0) {
                                int sizingEdge = SizingEdgeForHitTest(HitTestAtCursor(hwnd));
                                if (sizingEdge != 0) {
                                    ReleaseCapture();
                                    SendMessageW(hwnd, WM_SYSCOMMAND, SC_SIZE + sizingEdge, 0);
                                    return 0;
                                }
                            }
                            break;
                        }
                        case WM_SETCURSOR: {
                            if (!browserWindow->impl_->hasFrame) {
                                LRESULT hitTest = HitTestAtCursor(hwnd);
                                LPCWSTR cursorName = nullptr;
                                switch (hitTest) {
                                case HTLEFT:
                                case HTRIGHT: cursorName = IDC_SIZEWE; break;
                                case HTTOP:
                                case HTBOTTOM: cursorName = IDC_SIZENS; break;
                                case HTTOPLEFT:
                                case HTBOTTOMRIGHT: cursorName = IDC_SIZENWSE; break;
                                case HTTOPRIGHT:
                                case HTBOTTOMLEFT: cursorName = IDC_SIZENESW; break;
                                }
                                if (cursorName != nullptr) {
                                    SetCursor(LoadCursorW(nullptr, cursorName));
                                    return TRUE;
                                }
                            }
                            break;
                        }
                        case WM_ERASEBKGND: {
                            if (browserWindow->impl_->transparent || browserWindow->impl_->systemBackdropActive) {
                                return 1;
                            }
                            break;
                        }
                        case WM_SIZE: {
                            if (wp != browserWindow->impl_->windowState) {
                                WPARAM previousState = browserWindow->impl_->windowState;
                                browserWindow->impl_->windowState = wp;
                                if (wp == SIZE_MAXIMIZED) {
                                    browserWindow->impl_->callbacks.onMaximize();
                                }
                                else if (wp == SIZE_MINIMIZED) {
                                    browserWindow->impl_->callbacks.onMinimize();
                                }
                                else if (previousState == SIZE_MAXIMIZED) {
                                    browserWindow->impl_->callbacks.onUnmaximize();
                                }
                                else if (previousState == SIZE_MINIMIZED) {
                                    browserWindow->impl_->callbacks.onRestore();
                                }
                            }
                            RECT rect { };
                            GetClientRect(hwnd, &rect);
                            LONG width = rect.right - rect.left;
                            LONG height = rect.bottom - rect.top;
                            browserWindow->impl_->webView.impl_->SetRect(0, 0, width, height);
                            browserWindow->impl_->callbacks.onResize();
                            break;
                        }
                        case WM_EXITSIZEMOVE: {
                            RECT rect { };
                            GetClientRect(hwnd, &rect);
                            browserWindow->impl_->webView.impl_->SetRect(
                                0, 0, rect.right - rect.left, rect.bottom - rect.top
                            );
                            return 0;
                        }
                        case WM_MOVE: {
                            browserWindow->impl_->webView.impl_->ParentWindowPositionChanged();
                            browserWindow->impl_->callbacks.onMove();
                            break;
                        }
                        case WM_GETMINMAXINFO: {
                            LPMINMAXINFO mmInfo = (LPMINMAXINFO)lp;
                            mmInfo->ptMaxTrackSize = To96Dpi(browserWindow->impl_->windowWnd, browserWindow->impl_->maxTrackSize);
                            mmInfo->ptMinTrackSize = To96Dpi(browserWindow->impl_->windowWnd, browserWindow->impl_->minTrackSize);
                            return 0;
                        }
                        case WM_SIZING: {
                            if (browserWindow->impl_->aspectRatio <= 0) break;
                            RECT* rect = reinterpret_cast<RECT*>(lp);
                            RECT windowRect { };
                            RECT clientRect { };
                            GetWindowRect(hwnd, &windowRect);
                            GetClientRect(hwnd, &clientRect);
                            int frameWidth = (windowRect.right - windowRect.left) - (clientRect.right - clientRect.left);
                            int frameHeight = (windowRect.bottom - windowRect.top) - (clientRect.bottom - clientRect.top);
                            int width = rect->right - rect->left;
                            int height = rect->bottom - rect->top;
                            const POINT extra = browserWindow->impl_->aspectRatioExtraSize;
                            const double ratio = browserWindow->impl_->aspectRatio;

                            if (wp == WMSZ_TOP || wp == WMSZ_BOTTOM) {
                                width = static_cast<int>((height - frameHeight - extra.y) * ratio) + frameWidth + extra.x;
                                rect->right = rect->left + width;
                            }
                            else {
                                height = static_cast<int>((width - frameWidth - extra.x) / ratio) + frameHeight + extra.y;
                                if (wp == WMSZ_TOPLEFT || wp == WMSZ_TOPRIGHT) rect->top = rect->bottom - height;
                                else rect->bottom = rect->top + height;
                            }
                            return TRUE;
                        }
                        case WM_DPICHANGED: {
                            RECT* rect = reinterpret_cast<RECT*>(lp);
                            SetWindowPos(
                                browserWindow->impl_->windowWnd, nullptr,
                                rect->left, rect->top,
                                rect->right - rect->left, rect->bottom - rect->top,
                                SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
                            );
                            break;
                        }
                    }
                    if (browserWindow->impl_->compositor) {
                        browserWindow->impl_->compositor->Sync(hwnd, msg, wp, lp, browserWindow->impl_->active);
                    }
                }
                return DefWindowProcW(hwnd, msg, wp, lp);
            };
            wndClass.hCursor = LoadCursor(nullptr, IDC_ARROW);
            wndClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
            RegisterClassExW(&wndClass);
        }

        impl_->windowWnd = CreateWindowW(
            BrowserWindowWndClassName,
            L"",
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT, 0, 0,
            nullptr, nullptr,
            GetModuleHandleW(nullptr),
            nullptr
        );

        theme_host_->AllowDarkModeForWindow(impl_->windowWnd, theme_host_->ShouldSystemUseDarkMode());
        constexpr DWORD cornerPreferenceAttribute = 33;
        constexpr int roundCornerPreference = 2;
        DwmSetWindowAttribute(
            impl_->windowWnd,
            cornerPreferenceAttribute,
            &roundCornerPreference,
            sizeof(roundCornerPreference)
        );
        SetWindowLongPtrW(impl_->windowWnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

        webView.impl_->InitWithParent(impl_->windowWnd);
    }

    void BrowserWindow::Show() {
        ShowWindow(impl_->windowWnd, SW_SHOW);
        UpdateWindow(impl_->windowWnd);
        
        SetFocus(impl_->windowWnd);
    }

    void BrowserWindow::Hide() {
        ShowWindow(impl_->windowWnd, SW_HIDE);
    }

    void BrowserWindow::Focus() {
        ShowWindow(impl_->windowWnd, SW_SHOW);
        SetForegroundWindow(impl_->windowWnd);
        SetFocus(impl_->windowWnd);
    }

    bool BrowserWindow::IsVisible() {
        return IsWindowVisible(impl_->windowWnd);
    }

    bool BrowserWindow::IsFocused() {
        return GetForegroundWindow() == impl_->windowWnd;
    }

    bool BrowserWindow::IsMinimized() {
        return IsIconic(impl_->windowWnd);
    }

    bool BrowserWindow::IsMaximized() {
        return IsZoomed(impl_->windowWnd);
    }

    void BrowserWindow::SetFullScreen(bool fullScreen) {
        if (impl_->fullScreen == fullScreen) return;
        if (fullScreen) {
            impl_->windowedStyle = GetWindowLongW(impl_->windowWnd, GWL_STYLE);
            impl_->windowedPlacement.length = sizeof(WINDOWPLACEMENT);
            if (!GetWindowPlacement(impl_->windowWnd, &impl_->windowedPlacement)) return;

            MONITORINFO monitorInfo { sizeof(MONITORINFO) };
            if (!GetMonitorInfoW(MonitorFromWindow(impl_->windowWnd, MONITOR_DEFAULTTONEAREST), &monitorInfo)) return;
            SetWindowLongW(impl_->windowWnd, GWL_STYLE, impl_->windowedStyle & ~(WS_CAPTION | WS_THICKFRAME));
            SetWindowPos(
                impl_->windowWnd, HWND_TOP,
                monitorInfo.rcMonitor.left, monitorInfo.rcMonitor.top,
                monitorInfo.rcMonitor.right - monitorInfo.rcMonitor.left,
                monitorInfo.rcMonitor.bottom - monitorInfo.rcMonitor.top,
                SWP_NOOWNERZORDER | SWP_FRAMECHANGED
            );
            impl_->fullScreen = true;
            impl_->callbacks.onEnterFullScreen();
        }
        else {
            SetWindowLongW(impl_->windowWnd, GWL_STYLE, impl_->windowedStyle);
            SetWindowPlacement(impl_->windowWnd, &impl_->windowedPlacement);
            SetWindowPos(
                impl_->windowWnd, nullptr, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED
            );
            impl_->fullScreen = false;
            impl_->callbacks.onLeaveFullScreen();
        }
    }

    bool BrowserWindow::IsFullScreen() {
        return impl_->fullScreen;
    }

    void BrowserWindow::FlashFrame(bool flash) {
        DWORD flags = flash ? static_cast<DWORD>(FLASHW_ALL | FLASHW_TIMERNOFG) : FLASHW_STOP;
        FLASHWINFO flashInfo {
            sizeof(FLASHWINFO),
            impl_->windowWnd,
            flags,
            0,
            0
        };
        FlashWindowEx(&flashInfo);
    }

    namespace {
        void SetWindowButtonEnabled(HWND hwnd, LONG button, bool enabled) {
            LONG style = GetWindowLongW(hwnd, GWL_STYLE);
            if (enabled) {
                style |= button;
            }
            else {
                style &= ~button;
            }
            SetWindowLongW(hwnd, GWL_STYLE, style);
        }
    }

    void BrowserWindow::SetMaximizable(bool maximizable) {
        SetWindowButtonEnabled(impl_->windowWnd, WS_MAXIMIZEBOX, maximizable);
    }
    void BrowserWindow::SetMinimizable(bool minimizable) {
        SetWindowButtonEnabled(impl_->windowWnd, WS_MINIMIZEBOX, minimizable);
    }
    void BrowserWindow::SetResizable(bool resizable) {
        SetWindowButtonEnabled(impl_->windowWnd, WS_SIZEBOX, resizable);
    }
    void BrowserWindow::SetHasFrame(bool hasFrame) {
        impl_->hasFrame = hasFrame;
        LONG style = GetWindowLongW(impl_->windowWnd, GWL_STYLE);
        if (hasFrame) style |= WS_CAPTION | WS_SYSMENU;
        else style &= ~(WS_CAPTION | WS_SYSMENU);
        SetWindowLongW(impl_->windowWnd, GWL_STYLE, style);
        MARGINS margins = !hasFrame && impl_->hasShadow
            ? MARGINS { 0, 0, 1, 0 }
            : MARGINS { 0, 0, 0, 0 };
        DwmExtendFrameIntoClientArea(impl_->windowWnd, &margins);
        SetWindowPos(
            impl_->windowWnd, nullptr, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
        );
        RECT rect { };
        GetClientRect(impl_->windowWnd, &rect);
        impl_->webView.impl_->SetRect(0, 0, rect.right - rect.left, rect.bottom - rect.top);
    }

    void BrowserWindow::SetTitle(const std::string& utf8title) {
        std::wstring wtitle = UTF8ToWString(utf8title.c_str());
        SetWindowTextW(impl_->windowWnd, wtitle.c_str());
    }

    void BrowserWindow::SetClosable(bool closable) {
        UINT uEnable = closable ? (MF_BYCOMMAND | MF_ENABLED) : (MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
        EnableMenuItem(GetSystemMenu(impl_->windowWnd, FALSE), SC_CLOSE, uEnable);
    }

    void BrowserWindow::SetParent(const BrowserWindow* parent) {
        HWND currentParent = GetWindow(impl_->windowWnd, GW_OWNER);
        if (impl_->modal && currentParent != nullptr) EnableWindow(currentParent, TRUE);
        SetWindowLongPtrW(
            impl_->windowWnd,
            GWLP_HWNDPARENT,
            parent == nullptr ? 0 : reinterpret_cast<LONG_PTR>(parent->impl_->windowWnd)
        );
        HWND newParent = GetWindow(impl_->windowWnd, GW_OWNER);
        if (impl_->modal && newParent != nullptr) EnableWindow(newParent, FALSE);
    }

    void BrowserWindow::SetModal(bool modal) {
        HWND parent = GetWindow(impl_->windowWnd, GW_OWNER);
        if (parent != nullptr) EnableWindow(parent, !modal);
        impl_->modal = modal;
    }

    void BrowserWindow::SetSize(int width, int height, bool animate) {
        POINT scaledSize = To96Dpi(impl_->windowWnd, { width, height });
        SetWindowPos(
            impl_->windowWnd, nullptr, 0, 0,
            scaledSize.x, scaledSize.y,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE
        );
    }

    void BrowserWindow::SetContentSize(int width, int height, bool animate) {
        POINT scaledSize = To96Dpi(impl_->windowWnd, { width, height });
        RECT rect { 0, 0, scaledSize.x, scaledSize.y };
        AdjustWindowRectEx(
            &rect,
            GetWindowLongW(impl_->windowWnd, GWL_STYLE),
            GetMenu(impl_->windowWnd) != nullptr,
            GetWindowLongW(impl_->windowWnd, GWL_EXSTYLE)
        );
        SetWindowPos(
            impl_->windowWnd, nullptr, 0, 0,
            rect.right - rect.left, rect.bottom - rect.top,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE
        );
    }

    void BrowserWindow::SetMaximumSize(int width, int height) {
        impl_->maxTrackSize.x = (width == 0 ? LONG_MAX: width);
        impl_->maxTrackSize.y = (height == 0 ? LONG_MAX: height);
    }
    void BrowserWindow::SetMinimumSize(int width, int height) {
        impl_->minTrackSize.x = width;
        impl_->minTrackSize.y = height;
    }

    void BrowserWindow::SetAspectRatio(double ratio, int extraWidth, int extraHeight) {
        impl_->aspectRatio = ratio;
        impl_->aspectRatioExtraSize = { extraWidth, extraHeight };
    }

    std::vector<uint8_t> BrowserWindow::GetNativeWindowHandle() {
        std::vector<uint8_t> result(sizeof(impl_->windowWnd));
        std::memcpy(result.data(), &impl_->windowWnd, sizeof(impl_->windowWnd));
        return result;
    }

    void BrowserWindow::SetPosition(int x, int y, bool animate) {
        POINT scaledPosition = To96Dpi(impl_->windowWnd, POINT { x, y });
        UINT dpi = GetDpiForWindow(impl_->windowWnd);
        // LONG dpiScaledX = MulDiv(x, dpi, 96);
        // LONG dpiScaledY = MulDiv(y, dpi, 96);
        SetWindowPos(
            impl_->windowWnd, nullptr,
            scaledPosition.x, scaledPosition.y, 0, 0,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSIZE
        );
    }

    std::array<int, 2> BrowserWindow::GetSize() {
        RECT rect;
        check(GetWindowRect(impl_->windowWnd, &rect));
        POINT size = From96Dpi(impl_->windowWnd, { rect.right - rect.left, rect.bottom - rect.top });
        return { size.x, size.y };    }

    std::array<int, 2> BrowserWindow::GetContentSize() {
        RECT rect { };
        check(GetClientRect(impl_->windowWnd, &rect));
        POINT size = From96Dpi(impl_->windowWnd, { rect.right - rect.left, rect.bottom - rect.top });
        return { size.x, size.y };
    }

    void BrowserWindow::SetTransparent(bool transparent) {
        impl_->transparent = transparent;
        MARGINS margins = transparent ? MARGINS { -1, -1, -1, -1 } : MARGINS { 0, 0, 0, 0 };
        DwmExtendFrameIntoClientArea(impl_->windowWnd, &margins);
    }

    bool BrowserWindow::SetHasShadow(bool hasShadow) {
        impl_->hasShadow = hasShadow;
        if (!impl_->hasFrame) {
            MARGINS margins = hasShadow ? MARGINS { 0, 0, 1, 0 } : MARGINS { 0, 0, 0, 0 };
            return SUCCEEDED(DwmExtendFrameIntoClientArea(impl_->windowWnd, &margins));
        }
        DWMNCRENDERINGPOLICY policy = hasShadow ? DWMNCRP_ENABLED : DWMNCRP_DISABLED;
        return SUCCEEDED(DwmSetWindowAttribute(
            impl_->windowWnd,
            DWMWA_NCRENDERING_POLICY,
            &policy,
            sizeof(policy)
        ));
    }

    std::array<int, 2> BrowserWindow::GetPosition() {
        RECT rect;
        check(GetWindowRect(impl_->windowWnd, &rect));
        POINT position = From96Dpi(impl_->windowWnd, { rect.left, rect.top });
        return { position.x, position.y };
    }

    void BrowserWindow::Minimize() {
        ShowWindow(impl_->windowWnd, SW_MINIMIZE);
    }

    void BrowserWindow::Restore() {
        ShowWindow(impl_->windowWnd, SW_RESTORE);
    }

    void BrowserWindow::Maximize() {
        ShowWindow(impl_->windowWnd, SW_MAXIMIZE);
    }

    void BrowserWindow::Unmaximize() {
        if (IsMaximized()) ShowWindow(impl_->windowWnd, SW_RESTORE);
    }

    void BrowserWindow::Center() {
        RECT workAreaRect { };
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &workAreaRect, 0);

        int desktopWidth = workAreaRect.right -workAreaRect.left;
        int desktopHeight = workAreaRect.bottom - workAreaRect.top;

        RECT windowRect { };
        GetClientRect(impl_->windowWnd, &windowRect);

        int windowWidth = windowRect.right - windowRect.left;
        int windowHeight = windowRect.bottom - windowRect.top;

        SetWindowPos(
            impl_->windowWnd, nullptr,
            workAreaRect.left + (desktopWidth - windowWidth) / 2,
            workAreaRect.top + (desktopHeight - windowHeight) / 2, 0, 0,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSIZE
        );
    }

    void BrowserWindow::SetMenu(const Menu* menu) {
        if (impl_->menu != nullptr) DestroyMenu(impl_->menu);
        impl_->menu = menu == nullptr ? nullptr : menu->impl_->hmenu;
        ::SetMenu(impl_->windowWnd, impl_->menuBarVisible ? impl_->menu : nullptr);
        if (menu != nullptr) {
            menu->impl_->SetWindowWnd(impl_->windowWnd);
        }
        DrawMenuBar(impl_->windowWnd);
    }

    void BrowserWindow::SetAutoHideMenuBar(bool autoHide) {
        impl_->autoHideMenuBar = autoHide;
        SetMenuBarVisibility(!autoHide);
    }

    bool BrowserWindow::IsMenuBarAutoHide() {
        return impl_->autoHideMenuBar;
    }

    void BrowserWindow::SetMenuBarVisibility(bool visible) {
        impl_->menuBarVisible = visible;
        ::SetMenu(impl_->windowWnd, visible ? impl_->menu : nullptr);
        DrawMenuBar(impl_->windowWnd);
    }

    bool BrowserWindow::IsMenuBarVisible() {
        return impl_->menuBarVisible;
    }

    void BrowserWindow::SetIcon(const std::optional<std::string>& iconPath) {
        if (iconPath.has_value()) {
            std::wstring wiconPath = UTF8ToWString(iconPath->c_str());

            impl_->appIcon = LoadImage(nullptr, wiconPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
            if (impl_->appIcon != nullptr)
            {
                SendMessage(impl_->windowWnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(impl_->appIcon));
            }

            impl_->windowIcon = LoadImage(nullptr, wiconPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_LOADFROMFILE);
            if (impl_->windowIcon != nullptr)
            {            
                SendMessage(impl_->windowWnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(impl_->windowIcon));
            }
        }
    }

    void BrowserWindow::Destroy() {
        if (impl_->modal) {
            HWND parent = GetWindow(impl_->windowWnd, GW_OWNER);
            if (parent != nullptr) EnableWindow(parent, TRUE);
        }
        if (impl_->appIcon != nullptr && impl_->windowIcon != nullptr)
        {
            SendMessage(impl_->windowWnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(nullptr));
            SendMessage(impl_->windowWnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(nullptr));
            DeleteObject(impl_->appIcon);
            DeleteObject(impl_->windowIcon);
        }
        if (impl_->menu != nullptr) {
            ::SetMenu(impl_->windowWnd, nullptr);
            DestroyMenu(impl_->menu);
            impl_->menu = nullptr;
        }
        SetWindowLongPtrW(impl_->windowWnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(nullptr));
        DestroyWindow(impl_->windowWnd);
    }
    void BrowserWindow::Close() {

    }

    bool BrowserWindow::SetAcrylic(bool enabled) {
        if (!enabled) {
            impl_->compositor.reset();
            return true;
        }
        if (!impl_->compositor) {
            auto version = GetWindowsVersion();
            if (version.has_value()) {
                impl_->compositor.reset(Acrylic::AcrylicCompositor::Create(version->buildNumber).release());
            }
        }

        if (!impl_->compositor) return false;
        Acrylic::AcrylicCompositor::AcrylicEffectParameter param;
        param.blurAmount = 40;
        param.saturationAmount = 2;
        param.tintColor = D2D1::ColorF(0.0f, 0.0f, 0.0f, .30f);
        param.fallbackColor = D2D1::ColorF(0.10f,0.10f,0.10f,1.0f);
        return impl_->compositor->SetAcrylicEffect(
            impl_->windowWnd,
            Acrylic::AcrylicCompositor::BACKDROP_SOURCE_DESKTOP,
            param
        );
    }

    bool BrowserWindow::SetMica(bool enabled) {
        return false;
    }

    bool BrowserWindow::SetBackgroundMaterial(int material) {
        constexpr DWORD systemBackdropAttribute = 38;
        enum class BackdropType: int {
            AUTO = 0,
            NONE = 1,
            MICA = 2,
            ACRYLIC = 3,
            TABBED = 4,
        };

        if (!impl_->hasFrame
            && material != static_cast<int>(BackdropType::NONE)
            && material != static_cast<int>(BackdropType::ACRYLIC)) {
            return false;
        }
        impl_->compositor.reset();
        auto version = GetWindowsVersion();
        if (!impl_->hasFrame && material == static_cast<int>(BackdropType::ACRYLIC)) {
            const BackdropType none = BackdropType::NONE;
            DwmSetWindowAttribute(
                impl_->windowWnd,
                systemBackdropAttribute,
                &none,
                sizeof(none)
            );
            impl_->systemBackdropActive = false;
            return SetAcrylic(true);
        }
        if (version.has_value() && version->buildNumber >= 22621) {
            BackdropType backdrop = static_cast<BackdropType>(material);
            bool success = SUCCEEDED(DwmSetWindowAttribute(
                impl_->windowWnd,
                systemBackdropAttribute,
                &backdrop,
                sizeof(backdrop)
            ));
            if (success) {
                impl_->systemBackdropActive = backdrop != BackdropType::NONE;
                RedrawWindow(
                    impl_->windowWnd, nullptr, nullptr,
                    RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN
                );
            }
            return success;
        }
        if (material == static_cast<int>(BackdropType::AUTO) || material == static_cast<int>(BackdropType::NONE)) {
            return true;
        }
        if (material == static_cast<int>(BackdropType::ACRYLIC)) return SetAcrylic(true);
        return false;
    }

    void BrowserWindow::PopupMenu(const Menu& menu, const std::array<int, 2>* location, int positioningItem,  std::function<void()>&& onClose) {
        SetForegroundWindow(impl_->windowWnd);

        UINT uFlags = TPM_RIGHTBUTTON;
        if (GetSystemMetrics(SM_MENUDROPALIGNMENT) != 0)
        {
            uFlags |= TPM_RIGHTALIGN;
        }
        else
        {
            uFlags |= TPM_LEFTALIGN;
        }

        POINT pt;
        if (location != nullptr) {
            pt.x = std::get<0>(*location);
            pt.y = std::get<1>(*location);
            ClientToScreen(impl_->windowWnd, &pt);
        }
        else {
            GetCursorPos(&pt);
        }

        TrackPopupMenuEx(menu.impl_->hmenu, uFlags, pt.x, pt.y, impl_->windowWnd, NULL);
        onClose();
    }

    BrowserWindow::~BrowserWindow() = default;
}
