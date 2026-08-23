#include "menu_impl.h"
#include "tray.hpp"

#include <algorithm>
#include <gtk/gtk.h>

namespace DeskGap {
    struct Tray::Impl {
        GtkStatusIcon* statusIcon;
        EventCallbacks callbacks;
        std::string title;
        gint64 lastActivation = 0;

        explicit Impl(EventCallbacks&& eventCallbacks)
            : statusIcon(gtk_status_icon_new()), callbacks(std::move(eventCallbacks)) {
            g_signal_connect(statusIcon, "activate", G_CALLBACK(+[](GtkStatusIcon*, gpointer data) {
                Impl* implementation = static_cast<Impl*>(data);
                gint64 now = g_get_monotonic_time();
                if (now - implementation->lastActivation < 500 * 1000) {
                    implementation->callbacks.onDoubleClick();
                    implementation->lastActivation = 0;
                }
                else {
                    implementation->callbacks.onClick();
                    implementation->lastActivation = now;
                }
            }), this);
            g_signal_connect(statusIcon, "popup-menu", G_CALLBACK(+[](GtkStatusIcon*, guint, guint32, gpointer data) {
                static_cast<Impl*>(data)->callbacks.onRightClick();
            }), this);
            gtk_status_icon_set_visible(statusIcon, TRUE);
        }

        ~Impl() {
            gtk_status_icon_set_visible(statusIcon, FALSE);
            g_object_unref(statusIcon);
        }
    };

    namespace {
        GdkPixbuf* PixbufFrom(const NativeImage& image) {
            const NativeImage::Representation* representation = image.GetRepresentation();
            if (representation == nullptr) return nullptr;
            GdkPixbuf* pixbuf = gdk_pixbuf_new(
                GDK_COLORSPACE_RGB,
                TRUE,
                8,
                representation->pixelWidth,
                representation->pixelHeight
            );
            if (pixbuf == nullptr) return nullptr;
            guchar* destination = gdk_pixbuf_get_pixels(pixbuf);
            int destinationStride = gdk_pixbuf_get_rowstride(pixbuf);
            for (int row = 0; row < representation->pixelHeight; ++row) {
                std::copy_n(
                    representation->pixels.data() + static_cast<size_t>(row) * representation->pixelWidth * 4,
                    static_cast<size_t>(representation->pixelWidth) * 4,
                    destination + row * destinationStride
                );
            }
            return pixbuf;
        }
    }

    Tray::Tray(const NativeImage& image, const EventCallbacks&& callbacks)
        : impl_(new Impl(EventCallbacks(callbacks))) {
        SetImage(image);
    }

    Tray::~Tray() { Destroy(); }

    void Tray::Destroy() {
        delete impl_;
        impl_ = nullptr;
    }

    bool Tray::isDestroyed() { return impl_ == nullptr; }

    void Tray::SetImage(const NativeImage& image) {
        if (impl_ == nullptr) return;
        GdkPixbuf* pixbuf = PixbufFrom(image);
        if (pixbuf == nullptr) return;
        gtk_status_icon_set_from_pixbuf(impl_->statusIcon, pixbuf);
        g_object_unref(pixbuf);
    }

    void Tray::PopupMenu(const Menu& menu, const std::array<int, 2>*, int, std::function<void()>&& onClose) {
        if (impl_ == nullptr) return;
        auto closeCallback = new std::function<void()>(std::move(onClose));
        g_signal_connect_data(
            menu.impl_->gtkMenuShell,
            "deactivate",
            G_CALLBACK(+[](GtkMenuShell*, gpointer data) {
                (*static_cast<std::function<void()>*>(data))();
            }),
            closeCallback,
            +[](gpointer data, GClosure*) {
                delete static_cast<std::function<void()>*>(data);
            },
            G_CONNECT_AFTER
        );
        gtk_menu_popup(
            GTK_MENU(menu.impl_->gtkMenuShell),
            nullptr,
            nullptr,
            reinterpret_cast<GtkMenuPositionFunc>(gtk_status_icon_position_menu),
            impl_->statusIcon,
            0,
            gtk_get_current_event_time()
        );
    }

    void Tray::SetTooltip(const std::string& tooltip) {
        if (impl_ != nullptr) gtk_status_icon_set_tooltip_text(impl_->statusIcon, tooltip.c_str());
    }

    void Tray::SetTitle(const std::string& title) {
        if (impl_ != nullptr) impl_->title = title;
    }

    std::string Tray::GetTitle() {
        return impl_ == nullptr ? "" : impl_->title;
    }
}