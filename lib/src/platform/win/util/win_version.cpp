
#include "win_version.h"
#include <Windows.h>
#include <wil/resource.h>

namespace {
    typedef LONG(WINAPI *RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
    RtlGetVersionPtr GetVersionInfo;
    wil::unique_hmodule ntdll;
} // namespace

namespace DeskGap {
    std::optional<WindowsVersion> GetWindowsVersion() {
        if (!ntdll) {
            ntdll.reset(GetModuleHandleW(L"ntdll.dll"));
            if (ntdll) {
                GetVersionInfo = (RtlGetVersionPtr)GetProcAddress(ntdll.get(), "RtlGetVersion");
            }
        }
        if (GetVersionInfo) {
            RTL_OSVERSIONINFOW versionInfo = {0};
            versionInfo.dwOSVersionInfoSize = sizeof(versionInfo);
            if (GetVersionInfo(&versionInfo) == 0x00000000) {
                WindowsVersion version = {(unsigned long)versionInfo.dwMajorVersion, (unsigned long)versionInfo.dwMinorVersion,
                                       (unsigned long)versionInfo.dwBuildNumber};
                return std::make_optional<WindowsVersion>(std::move(version));
            }
        }
        return std::nullopt;
    }

    void WindowsVersion::Reset() { ntdll.release(); }
} // namespace DeskGap