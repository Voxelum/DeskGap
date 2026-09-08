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
        WPARAM windowState = SIZE_RESTORED;
        bool fullScreen = false;
        bool modal = false;
        bool hasFrame = true;
        bool titleBarHidden = false;
        bool hasShadow = true;
        bool transparent = false;
        bool systemBackdropActive = false;
        HMENU menu = nullptr;
        bool menuBarVisible = true;
        bool autoHideMenuBar = false;
        LONG windowedStyle = 0;
        WINDOWPLACEMENT windowedPlacement { sizeof(WINDOWPLACEMENT) };
        double aspectRatio = 0;
        POINT aspectRatioExtraSize { 0, 0 };

        HANDLE appIcon {nullptr};
        HANDLE windowIcon {nullptr};
    };
}

#endif
