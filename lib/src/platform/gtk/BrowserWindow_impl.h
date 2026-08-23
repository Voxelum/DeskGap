#ifndef gtk_browserwindow_impl_h
#define gtk_browserwindow_impl_h

#include <gtk/gtk.h>
#include <memory>

#include "browser_window.hpp"

namespace DeskGap {
    struct BrowserWindow::Impl {
    	GtkWindow* gtkWindow;
    	GtkBox* gtkBox;
        GtkWidget* webViewWidget;

    	struct AccelGroupMenu
    	{
    		GtkAccelGroup* accelGroup;
    		GtkWidget* menuBar;
    		AccelGroupMenu(const Menu& menu);
    		~AccelGroupMenu();
    	};
    	std::optional<AccelGroupMenu> accelGroupMenu;
        bool menuBarVisible = true;
        bool autoHideMenuBar = false;

    	BrowserWindow::EventCallbacks callbacks;

        gulong deleteEventConnection;
        static bool HandleDeleteEvent(GtkWidget*, GdkEvent*, BrowserWindow*);

        gulong focusInEventConnection;
        static bool HandleFocusInEvent(GtkWidget*, GdkEvent*, BrowserWindow*);

        gulong focusOutEventConnection;
        static bool HandleFocusOutEvent(GtkWidget*, GdkEvent*, BrowserWindow*);

        gulong keyPressEventConnection;
        static bool HandleKeyPressEvent(GtkWidget*, GdkEventKey*, BrowserWindow*);

        gulong windowStateEventConnection;
        static bool HandleWindowStateEvent(GtkWidget*, GdkEventWindowState*, BrowserWindow*);

        gulong configureEventConnection;
        static bool HandleConfigureEvent(GtkWidget*, GdkEventConfigure*, BrowserWindow*);
        struct Rect {
            gint x, y, width, height;
        };
        std::optional<Rect> lastRect;
        bool fullScreen = false;
    };
}

#endif
