#ifndef win_util_ui_theme_host_h
#define win_util_ui_theme_host_h

#include <Windows.h>
#include <memory>
#include <wil/resource.h>

namespace DeskGap {
    // wrap uxtheme.dll
    class UXThemeHost {
      public:
        enum class PreferredAppMode : INT { Default = 0, AllowDark = 1, ForceDark = 2, ForceLight = 3, Max = 4 };
        bool AllowDarkModeForWindow(HWND window, bool allow) {
            if (AllowDarkModeForWindow_) {
                return AllowDarkModeForWindow_(window, allow);
            }
            return false;
        }
        bool ShouldSystemUseDarkMode() {
            if (ShouldSystemUseDarkMode_) {
                return ShouldSystemUseDarkMode_();
            }
            return false;
        }

        PreferredAppMode SetPreferredAppMode(PreferredAppMode mode) {
            if (SetPreferredAppMode_) {
                return SetPreferredAppMode_(mode);
            }
            return PreferredAppMode::Default;
        }

        static std::unique_ptr<UXThemeHost> Create() {
            auto uxtheme = LoadLibraryEx(L"uxtheme.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
            if (uxtheme) {
                ThemeShouldSystemUseDarkMode ShouldSystemUseDarkMode_ =
                    reinterpret_cast<ThemeShouldSystemUseDarkMode>(GetProcAddress(uxtheme, MAKEINTRESOURCEA(138)));
                ThemeAllowDarkModeForWindow AllowDarkModeForWindow_ =
                    reinterpret_cast<ThemeAllowDarkModeForWindow>(GetProcAddress(uxtheme, MAKEINTRESOURCEA(133)));
                ThemeSetPreferredAppMode SetPreferredAppMode_ =
                    reinterpret_cast<ThemeSetPreferredAppMode>(GetProcAddress(uxtheme, MAKEINTRESOURCEA(135)));
                return std::make_unique<UXThemeHost>(uxtheme, ShouldSystemUseDarkMode_, AllowDarkModeForWindow_, SetPreferredAppMode_);
            }
            return nullptr;
        }

        typedef PreferredAppMode(WINAPI *ThemeSetPreferredAppMode)(PreferredAppMode appMode);
        typedef BOOL(WINAPI *ThemeAllowDarkModeForWindow)(IN HWND window, IN bool allow);
        typedef BOOL(WINAPI *ThemeShouldSystemUseDarkMode)();
        UXThemeHost(HMODULE uxtheme, ThemeShouldSystemUseDarkMode ThemeShouldSystemUseDarkMode,
                    ThemeAllowDarkModeForWindow ThemeAllowDarkModeForWindow, ThemeSetPreferredAppMode SetPreferredAppMode)
            : uxtheme_(uxtheme), ShouldSystemUseDarkMode_(ThemeShouldSystemUseDarkMode), AllowDarkModeForWindow_(ThemeAllowDarkModeForWindow),
              SetPreferredAppMode_(SetPreferredAppMode){};

      private:
        wil::unique_hmodule uxtheme_;
        ThemeShouldSystemUseDarkMode ShouldSystemUseDarkMode_;
        ThemeAllowDarkModeForWindow AllowDarkModeForWindow_;
        ThemeSetPreferredAppMode SetPreferredAppMode_;
    };
} // namespace DeskGap

#endif /* win_util_ui_theme_host_h */
