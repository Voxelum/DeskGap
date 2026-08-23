#include <Windows.h>
#include <cassert>
#include <atomic>
#include <thread>

#include "system_preferences.hpp"

#pragma comment(lib, "advapi32.lib")

namespace {
    std::atomic<DeskGap::SystemPreferences::ThemeSource> themeSource(
        DeskGap::SystemPreferences::ThemeSource::SYSTEM
    );

    bool getIsDarkModeFromOpenedHKey(HKEY hKey) {
        DWORD result = 1;
        unsigned long size = sizeof(result);
        LSTATUS queryResult = RegQueryValueExA(hKey, "AppsUseLightTheme", NULL, NULL, (LPBYTE)&result, &size);
        if (queryResult != ERROR_SUCCESS) {
            return false;
        }
        return result == 0;
    }

    bool getIsDarkMode() {
        HKEY hKey;
        if (RegOpenKeyExA(
            HKEY_CURRENT_USER,
            "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            0, KEY_QUERY_VALUE, &hKey
        ) != ERROR_SUCCESS) {
            return false;
        }
        bool isDarkMode = getIsDarkModeFromOpenedHKey(hKey);
        RegCloseKey(hKey);
        return isDarkMode;
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
        HKEY hKey;
        LSTATUS openError = RegOpenKeyExA(
            HKEY_CURRENT_USER,
            "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            0, KEY_NOTIFY | KEY_QUERY_VALUE, &hKey
        );
        if (openError != ERROR_SUCCESS) {
            return false;
        }

        bool isDarkMode = getIsDarkModeFromOpenedHKey(hKey);

        new std::thread([isDarkMode, hKey, onDarkModeToggled = std::move(onDarkModeToggled)]() {
            bool lastIsDarkMode = isDarkMode;
            do {
                bool newIsDarkMode = getIsDarkModeFromOpenedHKey(hKey);
                if (lastIsDarkMode != newIsDarkMode) {
                    lastIsDarkMode = newIsDarkMode;
                    onDarkModeToggled();
                }
            }
            while (RegNotifyChangeKeyValue(hKey, FALSE, REG_NOTIFY_CHANGE_LAST_SET, 0, FALSE) == ERROR_SUCCESS);
        });

        return isDarkMode;
    }

    SystemPreferences::ThemeSource SystemPreferences::GetThemeSource() {
        return themeSource.load();
    }

    void SystemPreferences::SetThemeSource(ThemeSource source) {
        themeSource.store(source);

        using SetPreferredAppMode = int(WINAPI*)(int);
        HMODULE uxTheme = GetModuleHandleW(L"uxtheme.dll");
        if (uxTheme == nullptr) uxTheme = LoadLibraryW(L"uxtheme.dll");
        if (uxTheme != nullptr) {
            auto setPreferredAppMode = reinterpret_cast<SetPreferredAppMode>(
                GetProcAddress(uxTheme, MAKEINTRESOURCEA(135))
            );
            if (setPreferredAppMode != nullptr) {
                int preferredMode = source == ThemeSource::DARK ? 2
                    : source == ThemeSource::LIGHT ? 3
                    : 1;
                setPreferredAppMode(preferredMode);
            }
        }
        SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, reinterpret_cast<LPARAM>(L"ImmersiveColorSet"), SMTO_ABORTIFHUNG, 100, nullptr);
    }

    bool SystemPreferences::ShouldUseDarkColors() {
        ThemeSource source = themeSource.load();
        if (source == ThemeSource::DARK) return true;
        if (source == ThemeSource::LIGHT) return false;
        return getIsDarkMode();
    }
}
