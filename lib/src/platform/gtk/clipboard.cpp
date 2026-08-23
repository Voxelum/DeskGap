#include "clipboard.hpp"

#include <gtk/gtk.h>

std::string DeskGap::Clipboard::ReadText() {
    GtkClipboard* clipboard = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
    gchar* text = gtk_clipboard_wait_for_text(clipboard);
    if (text == nullptr) return "";
    std::string result(text);
    g_free(text);
    return result;
}

bool DeskGap::Clipboard::WriteText(const std::string& text) {
    GtkClipboard* clipboard = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
    gtk_clipboard_set_text(clipboard, text.c_str(), static_cast<gint>(text.size()));
    gtk_clipboard_store(clipboard);
    return true;
}

bool DeskGap::Clipboard::WriteImage(const std::vector<uint8_t>& png) {
    if (png.empty()) return false;
    GdkPixbufLoader* loader = gdk_pixbuf_loader_new_with_type("png", nullptr);
    if (loader == nullptr) return false;
    GError* error = nullptr;
    bool loaded = gdk_pixbuf_loader_write(loader, png.data(), png.size(), &error)
        && gdk_pixbuf_loader_close(loader, &error);
    if (!loaded) {
        if (error != nullptr) g_error_free(error);
        g_object_unref(loader);
        return false;
    }
    GdkPixbuf* pixbuf = gdk_pixbuf_loader_get_pixbuf(loader);
    if (pixbuf == nullptr) {
        g_object_unref(loader);
        return false;
    }
    GtkClipboard* clipboard = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
    gtk_clipboard_set_image(clipboard, pixbuf);
    gtk_clipboard_store(clipboard);
    g_object_unref(loader);
    return true;
}
