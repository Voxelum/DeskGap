#ifndef win_util_win_version_h
#define win_util_win_version_h

#include <optional>

namespace DeskGap {
    class WindowsVersion {
      public:
        unsigned long majorVersion;
        unsigned long minorVersion;
        unsigned long buildNumber;

        static void Reset();
    };

    // ntdll.dll
    std::optional<WindowsVersion> GetWindowsVersion();
    // WindowsVersion GetWindowsVersion();
} // namespace DeskGap

#endif /* win_util_win_version_h */
