#include "external_window.hpp"
#include "dispatch.hpp"

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <strings.h>
#include <thread>
#include <vector>

#undef Status

namespace {
    thread_local int capturedXError = 0;

    int CaptureXError(Display*, XErrorEvent* event) {
        capturedXError = event->error_code;
        return 0;
    }

    template<typename T>
    std::vector<T> Property(Display* display, Window window, Atom property, Atom requestedType) {
        Atom actualType = None;
        int actualFormat = 0;
        unsigned long count = 0;
        unsigned long bytesAfter = 0;
        unsigned char* data = nullptr;
        const int status = XGetWindowProperty(
            display, window, property, 0, 1024 * 1024, False, requestedType,
            &actualType, &actualFormat, &count, &bytesAfter, &data
        );
        if (status != Success || data == nullptr || actualType != requestedType || actualFormat != 32) {
            if (data != nullptr) XFree(data);
            return {};
        }
        const T* values = reinterpret_cast<const T*>(data);
        std::vector<T> result(values, values + count);
        XFree(data);
        return result;
    }

    Window FindWindow(Display* display, uint32_t processId) {
        Window root = DefaultRootWindow(display);
        Atom list = XInternAtom(display, "_NET_CLIENT_LIST_STACKING", True);
        if (list == None) list = XInternAtom(display, "_NET_CLIENT_LIST", True);
        Atom pidProperty = XInternAtom(display, "_NET_WM_PID", True);
        if (list == None || pidProperty == None) return None;

        auto windows = Property<Window>(display, root, list, XA_WINDOW);
        for (auto iterator = windows.rbegin(); iterator != windows.rend(); ++iterator) {
            auto pids = Property<unsigned long>(display, *iterator, pidProperty, XA_CARDINAL);
            XWindowAttributes attributes {};
            if (!pids.empty() && pids[0] == processId
                && XGetWindowAttributes(display, *iterator, &attributes) != 0
                && attributes.map_state == IsViewable) {
                return *iterator;
            }
        }
        return None;
    }

    void SetFullscreen(Display* display, Window window, bool fullscreen) {
        Window root = DefaultRootWindow(display);
        Atom state = XInternAtom(display, "_NET_WM_STATE", False);
        Atom fullscreenState = XInternAtom(display, "_NET_WM_STATE_FULLSCREEN", False);
        XEvent event {};
        event.xclient.type = ClientMessage;
        event.xclient.window = window;
        event.xclient.message_type = state;
        event.xclient.format = 32;
        event.xclient.data.l[0] = fullscreen ? 1 : 0;
        event.xclient.data.l[1] = fullscreenState;
        event.xclient.data.l[3] = 1;
        XSendEvent(display, root, False, SubstructureRedirectMask | SubstructureNotifyMask, &event);
        XFlush(display);
    }

    bool IsFullscreen(Display* display, Window window) {
        Atom state = XInternAtom(display, "_NET_WM_STATE", True);
        Atom fullscreenState = XInternAtom(display, "_NET_WM_STATE_FULLSCREEN", True);
        if (state == None || fullscreenState == None) return false;
        auto states = Property<Atom>(display, window, state, XA_ATOM);
        return std::find(states.begin(), states.end(), fullscreenState) != states.end();
    }

    DeskGap::ExternalWindow::Result TryMoveAndResizeOnUI(
        uint32_t processId,
        const DeskGap::ExternalWindow::Bounds& bounds
    ) {
        using namespace DeskGap::ExternalWindow;
        Display* display = XOpenDisplay(nullptr);
        if (display == nullptr) return { Status::FAILED, 0, "Cannot connect to the X11 display" };
        Window window = FindWindow(display, processId);
        if (window == None) {
            XCloseDisplay(display);
            return { Status::NOT_FOUND };
        }

        const bool fullscreen = IsFullscreen(display, window);
        if (fullscreen) {
            SetFullscreen(display, window, false);
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
        capturedXError = 0;
        XErrorHandler previousErrorHandler = XSetErrorHandler(CaptureXError);
        XMoveResizeWindow(
            display,
            window,
            static_cast<int>(bounds.x),
            static_cast<int>(bounds.y),
            static_cast<unsigned int>(bounds.width),
            static_cast<unsigned int>(bounds.height)
        );
        XFlush(display);
        if (fullscreen) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            SetFullscreen(display, window, true);
        }
        XSync(display, False);
        XSetErrorHandler(previousErrorHandler);
        XCloseDisplay(display);
        if (capturedXError != 0) return { Status::FAILED, capturedXError, "XMoveResizeWindow failed" };
        return { Status::SUCCESS };
    }
}

bool DeskGap::ExternalWindow::IsSupported() {
    const char* display = std::getenv("DISPLAY");
    const char* session = std::getenv("XDG_SESSION_TYPE");
    return display != nullptr && display[0] != '\0'
        && (session == nullptr || strcasecmp(session, "wayland") != 0);
}

DeskGap::ExternalWindow::Result DeskGap::ExternalWindow::TryMoveAndResize(
    uint32_t processId,
    const Bounds& bounds,
    bool
) {
    if (!IsSupported()) return { Status::UNSUPPORTED };
    Result result { Status::FAILED, 0, "External window UI dispatch did not run" };
    DeskGap::DispatchSync([&]() { result = TryMoveAndResizeOnUI(processId, bounds); });
    return result;
}