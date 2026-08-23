#include "shell.hpp"

#include <gtk/gtk.h>

namespace {
    std::string FileURI(const std::string& path, GError** error) {
        gchar* uri = g_filename_to_uri(path.c_str(), nullptr, error);
        if (uri == nullptr) return "";
        std::string result(uri);
        g_free(uri);
        return result;
    }
}

bool DeskGap::Shell::OpenExternal(const std::string& urlString) {
    return gtk_show_uri(nullptr, urlString.c_str(), GDK_CURRENT_TIME, nullptr);
}

std::string DeskGap::Shell::OpenPath(const std::string& path) {
    GError* error = nullptr;
    std::string uri = FileURI(path, &error);
    if (!uri.empty() && gtk_show_uri(nullptr, uri.c_str(), GDK_CURRENT_TIME, &error)) {
        return "";
    }
    std::string message = error == nullptr ? "Failed to open path" : error->message;
    if (error != nullptr) g_error_free(error);
    return message;
}

bool DeskGap::Shell::ShowItemInFolder(const std::string& path) {
    GError* error = nullptr;
    std::string uri = FileURI(path, &error);
    if (uri.empty()) {
        if (error != nullptr) g_error_free(error);
        return false;
    }

    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(
        G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE,
        nullptr,
        "org.freedesktop.FileManager1",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1",
        nullptr,
        &error
    );
    if (proxy == nullptr) {
        if (error != nullptr) g_error_free(error);
        return false;
    }

    const gchar* uris[] = { uri.c_str(), nullptr };
    GVariant* result = g_dbus_proxy_call_sync(
        proxy,
        "ShowItems",
        g_variant_new("(^ass)", uris, ""),
        G_DBUS_CALL_FLAGS_NONE,
        -1,
        nullptr,
        &error
    );
    g_object_unref(proxy);
    if (result != nullptr) g_variant_unref(result);
    if (error != nullptr) {
        g_error_free(error);
        return false;
    }
    return true;
}

bool DeskGap::Shell::WriteShortcutLink(
    const std::string&,
    const std::string&,
    const ShortcutDetails&
) {
    return false;
}
