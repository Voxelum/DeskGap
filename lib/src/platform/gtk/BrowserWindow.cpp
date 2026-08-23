#include "browser_window.hpp"
#include "menu_impl.h"
#include "webview_impl.h"
#include "./BrowserWindow_impl.h"
#include "./glib_exception.h"
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif
#include <cstring>
#include <gdk/gdkkeysyms.h>

namespace DeskGap {
    int i = 0;

    bool BrowserWindow::Impl::HandleDeleteEvent(GtkWidget*, GdkEvent*, BrowserWindow* window) {
        window->impl_->callbacks.onClose();
        return true;
    }

    bool BrowserWindow::Impl::HandleFocusInEvent(GtkWidget*, GdkEvent*, BrowserWindow* window) {
        window->impl_->callbacks.onFocus();
        return FALSE;
    }

    bool BrowserWindow::Impl::HandleFocusOutEvent(GtkWidget*, GdkEvent*, BrowserWindow* window) {
        if (window->impl_->autoHideMenuBar) window->SetMenuBarVisibility(false);
        window->impl_->callbacks.onBlur();
        return FALSE;
    }

    bool BrowserWindow::Impl::HandleKeyPressEvent(GtkWidget*, GdkEventKey* event, BrowserWindow* window) {
        if (window->impl_->autoHideMenuBar && (event->keyval == GDK_KEY_Alt_L || event->keyval == GDK_KEY_Alt_R)) {
            window->SetMenuBarVisibility(true);
        }
        return FALSE;
    }

    bool BrowserWindow::Impl::HandleWindowStateEvent(GtkWidget*, GdkEventWindowState* event, BrowserWindow* window) {
        if ((event->changed_mask & GDK_WINDOW_STATE_ICONIFIED) != 0) {
            if ((event->new_window_state & GDK_WINDOW_STATE_ICONIFIED) != 0) window->impl_->callbacks.onMinimize();
            else window->impl_->callbacks.onRestore();
        }
        if ((event->changed_mask & GDK_WINDOW_STATE_MAXIMIZED) != 0) {
            if ((event->new_window_state & GDK_WINDOW_STATE_MAXIMIZED) != 0) window->impl_->callbacks.onMaximize();
            else window->impl_->callbacks.onUnmaximize();
        }
        if ((event->changed_mask & GDK_WINDOW_STATE_FULLSCREEN) != 0) {
            window->impl_->fullScreen = (event->new_window_state & GDK_WINDOW_STATE_FULLSCREEN) != 0;
            if (window->impl_->fullScreen) window->impl_->callbacks.onEnterFullScreen();
            else window->impl_->callbacks.onLeaveFullScreen();
        }
        return FALSE;
    }

    bool BrowserWindow::Impl::HandleConfigureEvent(GtkWidget*, GdkEventConfigure* eventConfigure, BrowserWindow* window) {
        std::optional<Rect>& lastRect = window->impl_->lastRect;
        const BrowserWindow::EventCallbacks& callbacks = window->impl_->callbacks;
        if (!lastRect.has_value()) {
            callbacks.onResize();
            callbacks.onMove();
        }
        else {
            if (eventConfigure->x != lastRect->x || eventConfigure->y != lastRect->y) {
                callbacks.onMove();
            }
            if (eventConfigure->width != lastRect->width || eventConfigure->height != lastRect->height) {
                callbacks.onResize();
            }
        }
        lastRect.emplace(Rect { eventConfigure->x, eventConfigure->y, eventConfigure->width, eventConfigure->height });
        return FALSE;
    }

    BrowserWindow::Impl::AccelGroupMenu::AccelGroupMenu(const Menu& menu): menuBar(GTK_WIDGET(menu.impl_->gtkMenuShell)) {
        accelGroup = gtk_accel_group_new();
        menu.impl_->SetAccelGroup(accelGroup);
    }
    BrowserWindow::Impl::AccelGroupMenu::~AccelGroupMenu() {
        g_object_unref(accelGroup);
    }

    
    BrowserWindow::BrowserWindow(const WebView& webView, EventCallbacks&& callbacks): impl_(std::make_unique<Impl>()) {
        impl_->callbacks = std::move(callbacks);
        impl_->webViewWidget = GTK_WIDGET(webView.impl_->gtkWebView);

        GtkWindow* gtkWindow = GTK_WINDOW(g_object_ref_sink(gtk_window_new(GTK_WINDOW_TOPLEVEL)));

        GtkBox* gtkBox = GTK_BOX(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
        gtk_widget_show(GTK_WIDGET(gtkBox));

        gtk_box_pack_end(gtkBox, impl_->webViewWidget, true, true, 0);
        gtk_container_add(GTK_CONTAINER(gtkWindow), GTK_WIDGET(gtkBox));

        impl_->deleteEventConnection = g_signal_connect(gtkWindow, "delete-event", G_CALLBACK(Impl::HandleDeleteEvent), this);
        impl_->focusInEventConnection = g_signal_connect(gtkWindow, "focus-in-event", G_CALLBACK(Impl::HandleFocusInEvent), this);
        impl_->focusOutEventConnection = g_signal_connect(gtkWindow, "focus-out-event", G_CALLBACK(Impl::HandleFocusOutEvent), this);
        impl_->keyPressEventConnection = g_signal_connect(gtkWindow, "key-press-event", G_CALLBACK(Impl::HandleKeyPressEvent), this);
        impl_->windowStateEventConnection = g_signal_connect(gtkWindow, "window-state-event", G_CALLBACK(Impl::HandleWindowStateEvent), this);
        impl_->configureEventConnection = g_signal_connect(gtkWindow, "configure-event", G_CALLBACK(Impl::HandleConfigureEvent), this);

        impl_->gtkWindow = gtkWindow;
        impl_->gtkBox = gtkBox;
    }

    BrowserWindow::~BrowserWindow() {
        g_object_unref(impl_->gtkBox);
        g_object_unref(impl_->gtkWindow);
    }

    void BrowserWindow::Show() {
        gtk_widget_show(GTK_WIDGET(impl_->gtkWindow));
    }

    void BrowserWindow::Hide() {
        gtk_widget_hide(GTK_WIDGET(impl_->gtkWindow));
    }

    void BrowserWindow::Focus() {
        gtk_window_present(impl_->gtkWindow);
    }

    bool BrowserWindow::IsVisible() {
        return gtk_widget_get_visible(GTK_WIDGET(impl_->gtkWindow));
    }

    bool BrowserWindow::IsFocused() {
        return gtk_window_is_active(impl_->gtkWindow);
    }

    bool BrowserWindow::IsMinimized() {
        GdkWindow* window = gtk_widget_get_window(GTK_WIDGET(impl_->gtkWindow));
        return window != nullptr && (gdk_window_get_state(window) & GDK_WINDOW_STATE_ICONIFIED) != 0;
    }

    bool BrowserWindow::IsMaximized() {
        GdkWindow* window = gtk_widget_get_window(GTK_WIDGET(impl_->gtkWindow));
        return window != nullptr && (gdk_window_get_state(window) & GDK_WINDOW_STATE_MAXIMIZED) != 0;
    }

    void BrowserWindow::SetFullScreen(bool fullScreen) {
        if (fullScreen == IsFullScreen()) return;
        if (fullScreen) gtk_window_fullscreen(impl_->gtkWindow);
        else gtk_window_unfullscreen(impl_->gtkWindow);
    }

    bool BrowserWindow::IsFullScreen() {
        GdkWindow* window = gtk_widget_get_window(GTK_WIDGET(impl_->gtkWindow));
        return window == nullptr ? impl_->fullScreen : (gdk_window_get_state(window) & GDK_WINDOW_STATE_FULLSCREEN) != 0;
    }

    void BrowserWindow::FlashFrame(bool flash) {
        gtk_window_set_urgency_hint(impl_->gtkWindow, flash);
    }

    void BrowserWindow::SetMaximizable(bool maximizable) {

    }
    void BrowserWindow::SetMinimizable(bool minimizable) {

    }
    void BrowserWindow::SetResizable(bool resizable) {
        gtk_window_set_resizable(impl_->gtkWindow, resizable);
    }
    void BrowserWindow::SetHasFrame(bool hasFrame) {
        gtk_window_set_decorated(impl_->gtkWindow, hasFrame);
    }

    void BrowserWindow::SetTitle(const std::string& utf8title) {
        gtk_window_set_title(impl_->gtkWindow, utf8title.c_str());
    }

    void BrowserWindow::SetClosable(bool closable) {
        gtk_window_set_deletable(impl_->gtkWindow, closable);
    }

    void BrowserWindow::SetParent(const BrowserWindow* parent) {
        gtk_window_set_transient_for(impl_->gtkWindow, parent == nullptr ? nullptr : parent->impl_->gtkWindow);
    }

    void BrowserWindow::SetModal(bool modal) {
        gtk_window_set_modal(impl_->gtkWindow, modal);
    }

    void BrowserWindow::SetSize(int width, int height, bool animate) {
        gtk_window_resize(impl_->gtkWindow, width, height);
    }

    void BrowserWindow::SetContentSize(int width, int height, bool animate) {
        gtk_window_resize(impl_->gtkWindow, width, height);
    }

    void BrowserWindow::SetMaximumSize(int width, int height) {
        GdkGeometry geometry; 
        geometry.max_height = (height == 0 ? INT_MAX: height);
        geometry.max_width = (width == 0 ? INT_MAX: width);
        gtk_window_set_geometry_hints(impl_->gtkWindow, nullptr, &geometry, GDK_HINT_MAX_SIZE);
    }
    void BrowserWindow::SetMinimumSize(int width, int height) {
        GdkGeometry geometry; 
        geometry.min_height = height;
        geometry.min_width = width;
        gtk_window_set_geometry_hints(impl_->gtkWindow, nullptr, &geometry, GDK_HINT_MIN_SIZE); 
    }

    void BrowserWindow::SetAspectRatio(double ratio, int, int) {
        GdkGeometry geometry { };
        geometry.min_aspect = ratio;
        geometry.max_aspect = ratio;
        gtk_window_set_geometry_hints(
            impl_->gtkWindow,
            nullptr,
            &geometry,
            ratio > 0 ? GDK_HINT_ASPECT : static_cast<GdkWindowHints>(0)
        );
    }

    std::vector<uint8_t> BrowserWindow::GetNativeWindowHandle() {
        GdkWindow* window = gtk_widget_get_window(GTK_WIDGET(impl_->gtkWindow));
#ifdef GDK_WINDOWING_X11
        if (window != nullptr && GDK_IS_X11_WINDOW(window)) {
            auto xid = gdk_x11_window_get_xid(window);
            std::vector<uint8_t> result(sizeof(xid));
            std::memcpy(result.data(), &xid, sizeof(xid));
            return result;
        }
#endif
        return {};
    }

    void BrowserWindow::SetPosition(int x, int y, bool animate) {
        gtk_window_move(impl_->gtkWindow, x, y);
    }

    std::array<int, 2> BrowserWindow::GetSize() {
        int width, height;
        gtk_window_get_size(impl_->gtkWindow, &width, &height);
        return { width, height };
    }
    std::array<int, 2> BrowserWindow::GetContentSize() {
        return GetSize();
    }
    void BrowserWindow::SetTransparent(bool transparent) {
        GdkScreen* screen = gtk_widget_get_screen(GTK_WIDGET(impl_->gtkWindow));
        GdkVisual* visual = transparent ? gdk_screen_get_rgba_visual(screen) : gdk_screen_get_system_visual(screen);
        if (visual != nullptr) gtk_widget_set_visual(GTK_WIDGET(impl_->gtkWindow), visual);
        gtk_widget_set_app_paintable(GTK_WIDGET(impl_->gtkWindow), transparent);
    }
    bool BrowserWindow::SetHasShadow(bool hasShadow) {
        return hasShadow;
    }

    std::array<int, 2> BrowserWindow::GetPosition() {
        int x, y;
        gtk_window_get_position(impl_->gtkWindow, &x, &y);
        return { x, y };
    }

    void BrowserWindow::Minimize() {
        gtk_window_iconify(impl_->gtkWindow);
    }

    void BrowserWindow::Restore() {
        gtk_window_deiconify(impl_->gtkWindow);
    }

    void BrowserWindow::Maximize() {
        gtk_window_maximize(impl_->gtkWindow);
    }

    void BrowserWindow::Unmaximize() {
        gtk_window_unmaximize(impl_->gtkWindow);
    }

    void BrowserWindow::Center() {
        GdkDisplay* display = gtk_widget_get_display(GTK_WIDGET(impl_->gtkWindow));
        GdkScreen* screen = gdk_display_get_default_screen(display);

        gint screenWidth = gdk_screen_get_width(screen);
        gint screenHeight = gdk_screen_get_height(screen);

        int windowWidth, windowHeight;
        gtk_window_get_size(impl_->gtkWindow, &windowWidth, &windowHeight);

        gtk_window_move(impl_->gtkWindow, (screenWidth - windowWidth) / 2, (screenHeight - windowHeight) / 2);
    }

    void BrowserWindow::SetMenu(const Menu* menu) {
        if (impl_->accelGroupMenu.has_value()) {
            gtk_container_remove(GTK_CONTAINER(impl_->gtkBox), impl_->accelGroupMenu->menuBar);
            gtk_window_remove_accel_group(impl_->gtkWindow, impl_->accelGroupMenu->accelGroup);
            impl_->accelGroupMenu.reset();
        }

        if (menu != nullptr) {
            impl_->accelGroupMenu.emplace(*menu);
            gtk_window_add_accel_group(impl_->gtkWindow, impl_->accelGroupMenu->accelGroup);
            gtk_box_pack_start(impl_->gtkBox, impl_->accelGroupMenu->menuBar, FALSE, FALSE, 0);
            gtk_widget_set_visible(impl_->accelGroupMenu->menuBar, impl_->menuBarVisible);
            //gtk_box_reorder_child(impl_->gtkBox, impl_->accelGroupMenu->menuBar, 0);
        }

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
        if (impl_->accelGroupMenu.has_value()) {
            gtk_widget_set_visible(impl_->accelGroupMenu->menuBar, visible);
        }
    }

    bool BrowserWindow::IsMenuBarVisible() {
        return impl_->menuBarVisible;
    }

    void BrowserWindow::SetIcon(const std::optional<std::string>& iconPath) {
        if (iconPath.has_value()) {
            GError* error = nullptr;
            gtk_window_set_icon_from_file(impl_->gtkWindow, iconPath->c_str(), &error);
            GlibException::ThrowAndFree(error);
        }
        else {
            gtk_window_set_icon(impl_->gtkWindow, nullptr);
        }
    }

    void BrowserWindow::Destroy() {
        for (gulong connection: { 
            impl_->deleteEventConnection,
            impl_->focusInEventConnection,
            impl_->focusOutEventConnection,
            impl_->windowStateEventConnection,
            impl_->configureEventConnection
        }) {
            g_signal_handler_disconnect(impl_->gtkWindow, connection);
        }
        gtk_widget_destroy(GTK_WIDGET(impl_->gtkWindow));
    }
    void BrowserWindow::Close() {
        gtk_window_close(impl_->gtkWindow);
    }

    namespace {
        struct PopupMenuDeactivateSignalData {
            std::function<void()> onClose;
            gulong connection;
        };
        void HandlePopupMenuDeactivate(GtkMenuShell* menuShell, PopupMenuDeactivateSignalData* data) {
            g_signal_handler_disconnect(menuShell, data->connection);
            data->onClose();
            delete data;
        }
    }

    void BrowserWindow::PopupMenu(const Menu& menu, const std::array<int, 2>* location, int positioningItem, std::function<void()>&& onClose) {
        GtkMenuPositionFunc positionFunc = nullptr;
        gpointer positionFuncData = nullptr;

        if (location != nullptr) {
            auto rootLocation = new std::array<int, 2>();
            GdkWindow* webViewGDKWindow = gtk_widget_get_window(impl_->webViewWidget);
            gdk_window_get_root_coords(
                webViewGDKWindow,
                std::get<0>(*location), std::get<1>(*location),
                &((*rootLocation)[0]), &((*rootLocation)[1])
            );

            positionFuncData = rootLocation;
            positionFunc = [](GtkMenu*, gint *x, gint *y, gboolean* push_in, gpointer user_data) {
                auto rootLocation = static_cast<std::array<int, 2>*>(user_data);
                *x = std::get<0>(*rootLocation);
                *y = std::get<1>(*rootLocation);
                delete rootLocation;
            };
        }
        auto signalData = new PopupMenuDeactivateSignalData { std::move(onClose), 0 };
        signalData->connection = g_signal_connect(menu.impl_->gtkMenuShell, "deactivate", G_CALLBACK(HandlePopupMenuDeactivate), signalData);
        gtk_menu_popup(
            GTK_MENU(menu.impl_->gtkMenuShell), nullptr, nullptr, 
            positionFunc, positionFuncData,
            0, GDK_CURRENT_TIME
        );
    }
}
