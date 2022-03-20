#ifndef win_browserwindow_impl_h
#define win_browserwindow_impl_h

#include <Windows.h>

#include "browser_window.hpp"
#include "util/acrylic_compositor.h"
#include "webview.hpp"

namespace DeskGap {
    struct BrowserWindow::Impl {
        HWND windowWnd;
        const WebView& webView;
        BrowserWindow::EventCallbacks callbacks;

        Impl(const WebView& webView, EventCallbacks& callbacks);

        POINT maxTrackSize;
        POINT minTrackSize;

        std::unique_ptr<Acrylic::AcrylicCompositor> compositor;
        bool active;

        HANDLE appIcon {nullptr};
        HANDLE windowIcon {nullptr};
    };
}

#endif
