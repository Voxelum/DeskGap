#include "ui_theme_host.hpp"

namespace DeskGap {
    bool UXThemeHost::AllowDarkModeForWindow(HWND window, bool allow) {
        if (AllowDarkModeForWindow_) {
            return AllowDarkModeForWindow_(window, allow);
        }
        return false;
    }

    bool UXThemeHost::ShouldSystemUseDarkMode() {
        if (!ShouldSystemUseDarkMode_) {
            return ShouldSystemUseDarkMode_();
        }
        return false;
    }

    std::unique_ptr<UXThemeHost> UXThemeHost::Create() {
        auto uxtheme = LoadLibraryEx(L"uxtheme.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (uxtheme) {
            ThemeShouldSystemUseDarkMode ShouldSystemUseDarkMode_ = reinterpret_cast<ThemeShouldSystemUseDarkMode>(GetProcAddress(uxtheme, MAKEINTRESOURCEA(138)));
            ThemeAllowDarkModeForWindow AllowDarkModeForWindow_ = reinterpret_cast<ThemeAllowDarkModeForWindow>(GetProcAddress(uxtheme, MAKEINTRESOURCEA(133)));
            return std::make_unique<UXThemeHost>(uxtheme, ShouldSystemUseDarkMode_, AllowDarkModeForWindow_);
        }
        return nullptr;
    }
} // namespace DeskGap
