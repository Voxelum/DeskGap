#include "notification.hpp"

#include <atomic>
#include <gio/gio.h>

namespace {
    std::atomic_uint64_t nextNotificationId { 1 };
}

struct DeskGap::Notification::Impl {
    Options options;
    EventCallbacks callbacks;
    std::string identifier;
    std::string actionName;
    GSimpleAction* action = nullptr;
    bool shown = false;

    Impl(Options&& options, EventCallbacks&& callbacks)
        : options(std::move(options)),
          callbacks(std::move(callbacks)),
          identifier("deskgap-" + std::to_string(nextNotificationId.fetch_add(1))),
          actionName("notification-" + std::to_string(nextNotificationId.fetch_add(1))) {}

    ~Impl() { Close(false); }

    void Show() {
        if (shown) return;
        GApplication* application = g_application_get_default();
        if (application == nullptr || !g_application_get_is_registered(application)) {
            callbacks.onFailed("GTK application is not registered for notifications");
            return;
        }

        action = g_simple_action_new(actionName.c_str(), nullptr);
        g_signal_connect(action, "activate", G_CALLBACK(+[](
            GSimpleAction*, GVariant*, gpointer data
        ) {
            Impl* impl = static_cast<Impl*>(data);
            if (!impl->shown) return;
            impl->shown = false;
            impl->callbacks.onClick();
            impl->CleanupNative(true);
            impl->callbacks.onClose();
        }), this);
        g_action_map_add_action(G_ACTION_MAP(application), G_ACTION(action));

        GNotification* notification = g_notification_new(options.title.c_str());
        if (!options.body.empty()) g_notification_set_body(notification, options.body.c_str());
        std::string defaultAction = "app." + actionName;
        g_notification_set_default_action(notification, defaultAction.c_str());
        if (!options.iconPng.empty()) {
            GBytes* bytes = g_bytes_new(options.iconPng.data(), options.iconPng.size());
            GIcon* icon = g_bytes_icon_new(bytes);
            g_notification_set_icon(notification, icon);
            g_object_unref(icon);
            g_bytes_unref(bytes);
        }
        g_application_send_notification(application, identifier.c_str(), notification);
        g_object_unref(notification);
        shown = true;
        callbacks.onShow();
    }

    void Close(bool emit = true) {
        bool wasShown = shown;
        shown = false;
        CleanupNative(wasShown);
        if (emit && wasShown) callbacks.onClose();
    }

    void CleanupNative(bool withdraw) {
        GApplication* application = g_application_get_default();
        if (application != nullptr) {
            if (withdraw) g_application_withdraw_notification(application, identifier.c_str());
            if (action != nullptr) g_action_map_remove_action(G_ACTION_MAP(application), actionName.c_str());
        }
        if (action != nullptr) {
            g_object_unref(action);
            action = nullptr;
        }
    }
};

DeskGap::Notification::Notification(Options&& options, EventCallbacks&& callbacks)
    : impl_(std::make_unique<Impl>(std::move(options), std::move(callbacks))) {}
DeskGap::Notification::~Notification() = default;
void DeskGap::Notification::Show() { impl_->Show(); }
void DeskGap::Notification::Close() { impl_->Close(); }
bool DeskGap::Notification::IsSupported() {
    GApplication* application = g_application_get_default();
    return application != nullptr && g_application_get_is_registered(application);
}
