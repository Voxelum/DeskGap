#include "system_preferences.hpp"

#include <atomic>
#include <gtk/gtk.h>

namespace {
    std::atomic<DeskGap::SystemPreferences::ThemeSource> themeSource(
        DeskGap::SystemPreferences::ThemeSource::SYSTEM
    );

    bool shouldUseDarkColors() {
        GtkSettings* settings = gtk_settings_get_default();
        if (settings == nullptr) return false;

        gboolean preferDark = FALSE;
        gchar* themeName = nullptr;
        g_object_get(settings,
            "gtk-application-prefer-dark-theme", &preferDark,
            "gtk-theme-name", &themeName,
            nullptr
        );
        bool isDark = preferDark || (themeName != nullptr && g_strrstr(themeName, "dark") != nullptr);
        g_free(themeName);
        return isDark;
    }
}

namespace DeskGap {
    void SystemPreferences::AskForMediaAccess(const std::string&, std::function<void(bool)>&& callback) {
        callback(true);
    }

    bool SystemPreferences::IsTrustedAccessibilityClient(bool) {
        return true;
    }
    bool SystemPreferences::GetAndWatchDarkMode(std::function<void()>&& onDarkModeToggled) {
        GtkSettings* settings = gtk_settings_get_default();
        if (settings != nullptr) {
            auto callback = new std::function<void()>(std::move(onDarkModeToggled));
            auto notify = [](GObject*, GParamSpec*, gpointer data) {
                (*static_cast<std::function<void()>*>(data))();
            };
            g_signal_connect(settings, "notify::gtk-application-prefer-dark-theme", G_CALLBACK(+notify), callback);
            g_signal_connect(settings, "notify::gtk-theme-name", G_CALLBACK(+notify), callback);
        }
        return shouldUseDarkColors();
    }

    SystemPreferences::ThemeSource SystemPreferences::GetThemeSource() {
        return themeSource.load();
    }

    void SystemPreferences::SetThemeSource(ThemeSource source) {
        themeSource.store(source);
        GtkSettings* settings = gtk_settings_get_default();
        if (settings != nullptr && source != ThemeSource::SYSTEM) {
            g_object_set(settings, "gtk-application-prefer-dark-theme", source == ThemeSource::DARK, nullptr);
        }
    }

    bool SystemPreferences::ShouldUseDarkColors() {
        ThemeSource source = themeSource.load();
        if (source == ThemeSource::DARK) return true;
        if (source == ThemeSource::LIGHT) return false;
        return shouldUseDarkColors();
    }
}
