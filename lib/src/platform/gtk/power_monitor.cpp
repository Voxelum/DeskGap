#include "power_monitor.hpp"

#include <gio/gio.h>
#include <optional>

namespace {
    DeskGap::PowerMonitor::EventCallbacks eventCallbacks;
    std::optional<bool> lastOnBattery;
    GDBusProxy* powerProxy = nullptr;
    GDBusProxy* loginProxy = nullptr;

    void PowerPropertiesChanged(GDBusProxy*, GVariant* changedProperties, const gchar* const*, gpointer) {
        gboolean onBattery;
        if (!g_variant_lookup(changedProperties, "OnBattery", "b", &onBattery)) return;

        bool value = onBattery;
        if (!lastOnBattery.has_value() || *lastOnBattery != value) {
            lastOnBattery = value;
            if (eventCallbacks.onPowerSourceChanged) eventCallbacks.onPowerSourceChanged(value);
        }
    }

    void LoginSignal(
        GDBusProxy*, const gchar*, const gchar* signalName, GVariant* parameters, gpointer
    ) {
        if (g_strcmp0(signalName, "PrepareForSleep") != 0) return;

        gboolean preparingForSleep;
        g_variant_get(parameters, "(b)", &preparingForSleep);
        if (preparingForSleep) {
            if (eventCallbacks.onSuspend) eventCallbacks.onSuspend();
        }
        else if (eventCallbacks.onResume) {
            eventCallbacks.onResume();
        }
    }
}

bool DeskGap::PowerMonitor::IsOnBatteryPower() {
    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(
        G_BUS_TYPE_SYSTEM,
        G_DBUS_PROXY_FLAGS_NONE,
        nullptr,
        "org.freedesktop.UPower",
        "/org/freedesktop/UPower",
        "org.freedesktop.UPower",
        nullptr,
        &error
    );
    if (proxy == nullptr) {
        if (error != nullptr) g_error_free(error);
        return false;
    }

    GVariant* value = g_dbus_proxy_get_cached_property(proxy, "OnBattery");
    bool onBattery = value != nullptr && g_variant_get_boolean(value);
    if (value != nullptr) g_variant_unref(value);
    g_object_unref(proxy);
    return onBattery;
}

void DeskGap::PowerMonitor::SetEventCallbacks(EventCallbacks&& callbacks) {
    eventCallbacks = std::move(callbacks);
    lastOnBattery = IsOnBatteryPower();

    if (powerProxy == nullptr) {
        powerProxy = g_dbus_proxy_new_for_bus_sync(
            G_BUS_TYPE_SYSTEM,
            G_DBUS_PROXY_FLAGS_NONE,
            nullptr,
            "org.freedesktop.UPower",
            "/org/freedesktop/UPower",
            "org.freedesktop.UPower",
            nullptr,
            nullptr
        );
        if (powerProxy != nullptr) {
            g_signal_connect(powerProxy, "g-properties-changed", G_CALLBACK(PowerPropertiesChanged), nullptr);
        }
    }

    if (loginProxy == nullptr) {
        loginProxy = g_dbus_proxy_new_for_bus_sync(
            G_BUS_TYPE_SYSTEM,
            G_DBUS_PROXY_FLAGS_NONE,
            nullptr,
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            nullptr,
            nullptr
        );
        if (loginProxy != nullptr) {
            g_signal_connect(loginProxy, "g-signal", G_CALLBACK(LoginSignal), nullptr);
        }
    }
}
