#include "app.hpp"
#include "./util/wstring_utf8.h"
#include "dispatch_wnd.hpp"
#include "process_singleton.hpp"
#include "util/reg_key.hpp"
#include "util/ui_theme_host.hpp"
#include "webview_impl.h"
#include <cstdlib>
#include <fileapi.h>
#include <filesystem>
#include <memory>
#include <shlobj_core.h>

namespace DeskGap {
    HWND appWindowWnd;
    extern LRESULT OnTrayClick(WPARAM wp, LPARAM lp);
    std::unique_ptr<ProcessSingleton> process_singleton_;
    std::unique_ptr<UXThemeHost> theme_host_;

    bool App::SetAsDefaultProtocolClient(const std::string &protocol) {
        // HKEY_CLASSES_ROOT
        //    $PROTOCOL
        //       (Default) = "URL:$NAME"
        //       URL Protocol = ""
        //       shell
        //          open
        //             command
        //                (Default) = "$COMMAND" "%1"
        //
        // However, the "HKEY_CLASSES_ROOT" key can only be written by the
        // Administrator user. So, we instead write to "HKEY_CURRENT_USER\
        // Software\Classes", which is inherited by "HKEY_CLASSES_ROOT"
        // anyway, and can be written by unprivileged users.

        if (protocol.empty())
            return false;

        std::wstring exe(UTF8ToWString(GetExecutablePath()));
        // if (!GetProtocolLaunchPath(args, &exe))
        //     return false;

        // Main Registry Key
        HKEY root = HKEY_CURRENT_USER;
        std::wstring keyPath = UTF8ToWString("Software\\Classes\\" + protocol);
        std::wstring urlDecl = UTF8ToWString("URL:" + protocol);

        // Command Key
        std::wstring cmdPath = keyPath + L"\\shell\\open\\command";

        // Write information to registry
        RegKey key(root, keyPath.c_str(), KEY_ALL_ACCESS);
        if (FAILED(key.WriteValue(L"URL Protocol", L"")) || FAILED(key.WriteValue(L"", urlDecl.c_str())))
            return false;

        RegKey commandKey(root, cmdPath.c_str(), KEY_ALL_ACCESS);
        if (FAILED(commandKey.WriteValue(L"", exe.c_str())))
            return false;

        return true;
    }

    std::string App::GetLocale() {
        wchar_t buf[LOCALE_NAME_MAX_LENGTH];
        GetUserDefaultLocaleName(buf, LOCALE_NAME_MAX_LENGTH);
        return WStringToUTF8(buf);
    }

    bool App::IsDefaultProtocolClient(const std::string &protocol) {
        if (protocol.empty())
            return false;

        std::wstring exe(UTF8ToWString(GetExecutablePath()));
        // if (!GetProtocolLaunchPath(args, &exe))
        //     return false;

        // Main Registry Key
        HKEY root = HKEY_CURRENT_USER;
        std::string keyPathA("Software\\Classes\\" + protocol);
        std::wstring keyPath(UTF8ToWString(keyPathA.c_str()));

        // Command Key
        std::wstring cmdPath = keyPath + L"\\shell\\open\\command";

        RegKey key;
        RegKey commandKey;
        if (FAILED(key.Open(root, keyPath.c_str(), KEY_ALL_ACCESS)))
            // Key doesn't exist, we can confirm that it is not set
            return false;

        if (FAILED(commandKey.Open(root, cmdPath.c_str(), KEY_ALL_ACCESS)))
            // Key doesn't exist, we can confirm that it is not set
            return false;

        std::wstring keyVal;
        if (FAILED(commandKey.ReadValue(L"", &keyVal)))
            // Default value not set, we can confirm that it is not set
            return false;

        // Default value is the same as current file path
        return keyVal == exe;
    }

    bool App::RequestSingleInstanceLock(SecondInstanceEventCallback &&callbacks) {
        if (HasSingleInstanceLock())
            return true;
        namespace fs = std::filesystem;

        fs::path executablePath(App::GetExecutablePath());
        auto program_name(executablePath.filename().replace_extension(""));

        PWSTR user_dir = NULL;
        SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_CREATE, NULL, &user_dir);
        fs::path user_dir_str(user_dir);
        user_dir_str /= program_name;

        // blink::CloneableMessage additional_data_message;
        // args->GetNext(&additional_data_message);
#ifdef WIN32
        // bool app_is_sandboxed = IsSandboxEnabled(base::CommandLine::ForCurrentProcess());
        bool app_is_sandboxed = false;
        process_singleton_ =
            std::make_unique<ProcessSingleton>(program_name.string(), user_dir_str.wstring(), app_is_sandboxed, std::move(callbacks));
#else
        process_singleton_ = std::make_unique<ProcessSingleton>(program_name, user_dir, std::move(callbacks));
#endif
        CoTaskMemFree(user_dir);

        switch (process_singleton_->NotifyOtherProcessOrCreate()) {
        case NotifyResult::LOCK_ERROR:
        case NotifyResult::PROFILE_IN_USE:
        case NotifyResult::PROCESS_NOTIFIED: {
            process_singleton_.reset();
            return false;
        }
        case NotifyResult::PROCESS_NONE:
        default: // Shouldn't be needed, but VS warns if it is not there.
            return true;
        }
    }

    bool App::HasSingleInstanceLock() {
        if (process_singleton_)
            return true;
        return false;
    }

    void App::ReleaseSingleInstanceLock() {
        if (process_singleton_) {
            process_singleton_->Cleanup();
            process_singleton_.reset();
        }
    }

    void App::Init() {
        OleInitialize(nullptr);

        WNDCLASSEXW dispatcherWindowClass{};
        dispatcherWindowClass.cbSize = sizeof(WNDCLASSEXW);
        dispatcherWindowClass.hInstance = GetModuleHandleW(nullptr);
        dispatcherWindowClass.lpszClassName = DispatcherWndClassName;
        dispatcherWindowClass.lpfnWndProc = [](HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) -> LRESULT {
            if (msg == DG_DISPATCH_MSG) {
                // handle dispatch message posted from dispatch.cpp
                auto action = reinterpret_cast<std::function<void()> *>(lp);
                (*action)();
                delete action;
                return 0;
            } else if (msg == DG_TRAY_MSG) {
                return DeskGap::OnTrayClick(wp, lp);
            } else if (msg == WM_COPYDATA) {
                // Handle the WM_COPYDATA message from another process
                const COPYDATASTRUCT *cds = reinterpret_cast<COPYDATASTRUCT *>(lp);
                if (process_singleton_) {
                    process_singleton_->ProcessLaunchNotification(static_cast<const void *>(cds));
                }
            }

            return DefWindowProcW(hwnd, msg, wp, lp);
        };
        RegisterClassExW(&dispatcherWindowClass);

        appWindowWnd = CreateWindowW(DispatcherWndClassName, L"__DISPATCH__", 0, 0, 0, 0, 0, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);

        if (!theme_host_) {
            theme_host_.reset(UXThemeHost::Create().release());
        }
        if (theme_host_) {
            theme_host_->SetPreferredAppMode(UXThemeHost::PreferredAppMode::AllowDark);
            theme_host_->AllowDarkModeForWindow(appWindowWnd, theme_host_->ShouldSystemUseDarkMode());
        }
    }

    void App::Run(EventCallbacks &&callbacks) {
        callbacks.onReady();
        MSG msg;
        BOOL res;
        while ((res = GetMessageW(&msg, nullptr, 0, 0)) != -1) {
            if (msg.message == WM_MENUCOMMAND) {
                MENUINFO info{};
                info.cbSize = sizeof(info);
                info.fMask = MIM_MENUDATA;
                GetMenuInfo((HMENU)msg.lParam, &info);
                auto clickHandlers = reinterpret_cast<std::vector<std::function<void()> *> *>(info.dwMenuData);
                (*((*clickHandlers)[msg.wParam]))();
            } else if (msg.message == WM_QUIT) {
                return;
            } else if (msg.hwnd) {
                if (tridentWebViewTranslateMessage != nullptr) {
                    if (tridentWebViewTranslateMessage(&msg))
                        continue;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    void App::Exit(int exitCode) { ExitProcess(static_cast<UINT>(exitCode)); }

    std::string App::GetPath(PathName name) {
        static std::unordered_map<PathName, KNOWNFOLDERID> folderIdByName{
            {PathName::APP_DATA, FOLDERID_RoamingAppData}, {PathName::DESKTOP, FOLDERID_Desktop}, {PathName::DOCUMENTS, FOLDERID_Documents},
            {PathName::DOWNLOADS, FOLDERID_Downloads},     {PathName::MUSIC, FOLDERID_Music},     {PathName::PICTURES, FOLDERID_Pictures},
            {PathName::VIDEOS, FOLDERID_Videos},           {PathName::HOME, FOLDERID_Profile}};

        if (name == PathName::TEMP) {
            DWORD length = GetTempPathW(0, NULL);
            std::vector<wchar_t> pathBuffer(length);
            GetTempPathW(length, pathBuffer.data());
            return WStringToUTF8(pathBuffer.data());
        } else {
            KNOWNFOLDERID folderId = folderIdByName[name];
            PWSTR pwPath = NULL;
            SHGetKnownFolderPath(folderId, KF_FLAG_CREATE, NULL, &pwPath);
            std::string result = WStringToUTF8(pwPath);
            CoTaskMemFree(pwPath);
            return result;
        }
    }

    std::string App::GetExecutablePath() {
        namespace fs = std::filesystem;
        wchar_t pathBuffer[MAX_PATH];

        DWORD execPathSize = GetModuleFileNameW(nullptr, pathBuffer, MAX_PATH);
        assert(execPathSize > 0);

        return WStringToUTF8(pathBuffer);
    }

    std::string App::GetResourcePath(const char *argv0) {
        namespace fs = std::filesystem;

        std::string execPath(GetExecutablePath());
        return (fs::path(execPath).parent_path() / "resources").string();
    }

} // namespace DeskGap
