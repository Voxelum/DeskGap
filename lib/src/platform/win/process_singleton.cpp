// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "process_singleton.hpp"
#include "process_finder.hpp"
#include "process_singleton_impl.h"
#include "util/win32_check.h"
#include "util/wstring_utf8.h"
#include <Wbemidl.h>
#include <comutil.h>
#include <fileapi.h>
#include <shellapi.h>
#include <synchapi.h>
#include <wrl/client.h>
#pragma comment(lib, "wbemuuid.lib")

#ifndef INVALID_HANDLE_VALUE
// Work around there being two slightly different definitions in the SDK.
#define INVALID_HANDLE_VALUE ((HANDLE)(LONG_PTR)-1)
#endif

namespace {
    using namespace Microsoft::WRL;

    const char kLockfile[] = "lockfile";

    // A helper class that acquires the given |mutex| while the AutoLockMutex is in
    // scope.
    class AutoLockMutex {
      public:
        explicit AutoLockMutex(HANDLE mutex) : mutex_(mutex) {
            DWORD result = ::WaitForSingleObject(mutex_, INFINITE);
            check(result == WAIT_OBJECT_0);
        }

        AutoLockMutex(const AutoLockMutex &) = delete;
        AutoLockMutex &operator=(const AutoLockMutex &) = delete;

        ~AutoLockMutex() {
            BOOL released = ::ReleaseMutex(mutex_);
            check(released);
            CloseHandle(mutex_); // close mutex handle
        }

      private:
        HANDLE mutex_;
    };

    bool CreateLocalWmiConnection(bool set_blanket, ComPtr<IWbemServices> *wmi_services) {
        // Mitigate the issues caused by loading DLLs on a background thread
        // (http://crbug/973868).
        // SCOPED_MAY_LOAD_LIBRARY_AT_BACKGROUND_PRIORITY();

        ComPtr<IWbemLocator> wmi_locator;
        HRESULT hr = ::CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wmi_locator));
        if (FAILED(hr))
            return false;

        ComPtr<IWbemServices> wmi_services_r;
        hr = wmi_locator->ConnectServer(_bstr_t(L"ROOT\\CIMV2"), nullptr, nullptr, nullptr, 0, nullptr, nullptr, &wmi_services_r);
        if (FAILED(hr))
            return false;

        if (set_blanket) {
            hr = ::CoSetProxyBlanket(wmi_services_r.Get(), RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr, RPC_C_AUTHN_LEVEL_CALL,
                                     RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE);
            if (FAILED(hr))
                return false;
        }

        *wmi_services = std::move(wmi_services_r);
        return true;
    }

    bool CreateWmiClassMethodObject(IWbemServices *wmi_services, const wchar_t *class_name, const wchar_t *method_name,
                                    ComPtr<IWbemClassObject> *class_instance) {
        // We attempt to instantiate a COM object that represents a WMI object plus
        // a method rolled into one entity.
        _bstr_t b_class_name(class_name);
        _bstr_t b_method_name(method_name);
        ComPtr<IWbemClassObject> class_object;
        HRESULT hr;
        hr = wmi_services->GetObject(b_class_name, 0, nullptr, &class_object, nullptr);
        if (FAILED(hr))
            return false;

        ComPtr<IWbemClassObject> params_def;
        hr = class_object->GetMethod(b_method_name, 0, &params_def, nullptr);
        if (FAILED(hr))
            return false;

        if (!params_def.Get()) {
            // You hit this special case if the WMI class is not a CIM class. MSDN
            // sometimes tells you this. Welcome to WMI hell.
            return false;
        }

        hr = params_def->SpawnInstance(0, &(*class_instance));
        return SUCCEEDED(hr);
    }

    // The code in Launch() basically calls the Create Method of the Win32_Process
    // CIM class is documented here:
    // http://msdn2.microsoft.com/en-us/library/aa389388(VS.85).aspx
    // NOTE: The documentation for the Create method suggests that the ProcessId
    // parameter and return value are of type uint32_t, but when we call the method
    // the values in the returned out_params, are VT_I4, which is int32_t.
    bool WmiLaunchProcess(const std::wstring &command_line, int *process_id) {
        ComPtr<IWbemServices> wmi_local;
        if (!CreateLocalWmiConnection(true, &wmi_local))
            return false;

        static constexpr wchar_t class_name[] = L"Win32_Process";
        static constexpr wchar_t method_name[] = L"Create";
        ComPtr<IWbemClassObject> process_create;
        if (!CreateWmiClassMethodObject(wmi_local.Get(), class_name, method_name, &process_create)) {
            return false;
        }

        _variant_t var_command_line(command_line.c_str());

        if ((process_create->Put(L"CommandLine", 0, &var_command_line, 0))) {
            return false;
        }

        ComPtr<IWbemClassObject> out_params;
        HRESULT hr = wmi_local->ExecMethod(_bstr_t(class_name), _bstr_t(method_name), 0, nullptr, process_create.Get(), &out_params, nullptr);
        if (FAILED(hr))
            return false;

        // We're only expecting int32_t or uint32_t values, so no need for
        // ScopedVariant.
        VARIANT ret_value = {{{VT_EMPTY}}};
        hr = out_params->Get(L"ReturnValue", 0, &ret_value, nullptr, nullptr);
        if (FAILED(hr) || V_I4(&ret_value) != 0)
            return false;

        VARIANT pid = {{{VT_EMPTY}}};
        hr = out_params->Get(L"ProcessId", 0, &pid, nullptr, nullptr);
        if (FAILED(hr) || V_I4(&pid) == 0)
            return false;

        if (process_id)
            *process_id = V_I4(&pid);

        return true;
    }

    // Checks the visibility of the enumerated window and signals once a visible
    // window has been found.
    BOOL CALLBACK BrowserWindowEnumeration(HWND window, LPARAM param) {
        bool *result = reinterpret_cast<bool *>(param);
        *result = ::IsWindowVisible(window) != 0;
        // Stops enumeration if a visible window has been found.
        return !*result;
    }
} // namespace

namespace DeskGap {
    ProcessSingleton::Impl::Impl(SecondInstanceEventCallback &&event_callback)
        : lock_file_(INVALID_HANDLE_VALUE), event_callback_(event_callback) {}

    ProcessSingleton::ProcessSingleton(const std::string &program_name, const std::wstring &user_data_dir, bool is_app_sandboxed,
                                       SecondInstanceEventCallback &&event_callback)
        : program_name_(program_name), user_data_dir_(user_data_dir), is_app_sandboxed_(is_app_sandboxed), is_virtualized_(false),
          impl_(new Impl(std::move(event_callback))) {}

    ProcessSingleton::~ProcessSingleton() { delete impl_; }

    void ProcessSingleton::Cleanup() { DestroyWindow(impl_->hwnd_); }

    NotifyResult ProcessSingleton::NotifyOtherProcessOrCreate() {
        // TRACE_EVENT0("startup", "ProcessSingleton::NotifyOtherProcessOrCreate");
        // const base::TimeTicks begin_ticks = base::TimeTicks::Now();
        for (int i = 0; i < 2; ++i) {
            if (Create()) {
                // UMA_HISTOGRAM_MEDIUM_TIMES("Chrome.ProcessSingleton.TimeToCreate", base::TimeTicks::Now() - begin_ticks);
                return NotifyResult::PROCESS_NONE; // This is the single browser process.
            }
            NotifyResult result = NotifyOtherProcess();
            if (result == PROCESS_NOTIFIED || result == LOCK_ERROR) {
                // if (result == PROCESS_NOTIFIED) {
                //     UMA_HISTOGRAM_MEDIUM_TIMES("Chrome.ProcessSingleton.TimeToNotify", base::TimeTicks::Now() - begin_ticks);
                // } else {
                //     UMA_HISTOGRAM_MEDIUM_TIMES("Chrome.ProcessSingleton.TimeToFailure", base::TimeTicks::Now() - begin_ticks);
                // }
                // The single browser process was notified, the user chose not to
                // terminate a hung browser, or the lock file could not be created.
                // Nothing more to do.
                return result;
            }
            check(result == PROCESS_NONE);
            // DCHECK_EQ(PROCESS_NONE, result);
            // The process could not be notified for some reason, or it was hung and
            // terminated. Retry once if this is the first time; otherwise, fall through
            // to report that the process must exit because the profile is in use.
        }
        // UMA_HISTOGRAM_MEDIUM_TIMES("Chrome.ProcessSingleton.TimeToFailure", base::TimeTicks::Now() - begin_ticks);
        return NotifyResult::PROFILE_IN_USE;
    }

    bool ProcessSingleton::Create() {
        impl_->remote_window_ = DeskGap::FindRunningWindow(user_data_dir_);

        if (!impl_->remote_window_ && !EscapeVirtualization()) {
            std::string mutexNameA = "Local\\" + program_name_ + "ProcessSingletonStartup";
            std::wstring mutextName = UTF8ToWString(mutexNameA.c_str());

            HANDLE handle = ::CreateMutexW(NULL, FALSE, mutextName.c_str());

            if (handle == nullptr || handle == INVALID_HANDLE_VALUE) {
                auto error = GetLastError();
                return false;
            }
            // Make sure we will be the one and only process creating the window.
            // We use a named Mutex since we are protecting against multi-process
            // access. As documented, it's clearer to NOT request ownership on creation
            // since it isn't guaranteed we will get it. It is better to create it
            // without ownership and explicitly get the ownership afterward.
            AutoLockMutex mutex(handle);

            // We now own the mutex so we are the only process that can create the
            // window at this time, but we must still check if someone created it
            // between the time where we looked for it above and the time the mutex
            // was given to us.
            impl_->remote_window_ = DeskGap::FindRunningWindow(user_data_dir_);

            if (!impl_->remote_window_) {
                // We have to make sure there is no Chrome instance running on another
                // machine that uses the same profile.
                {
                    const wchar_t kLockfile[] = L"lockfile";
                    std::wstring lock_file_path(user_data_dir_);
                    lock_file_path.append(kLockfile);
                    impl_->lock_file_ = ::CreateFile(lock_file_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS,
                                                     FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE, NULL);
                }
                DWORD error = ::GetLastError();

                if (impl_->lock_file_ != INVALID_HANDLE_VALUE) {
                    impl_->hwnd_ = CreateWindow(DispatcherWndClassName, user_data_dir_.c_str(), 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr,
                                                GetModuleHandleW(nullptr), nullptr);
                    // When the app is sandboxed, firstly, the app should not be in
                    // admin mode, and even if it somehow is, messages from an unelevated
                    // instance should not be able to be sent to it.
                    if (!is_app_sandboxed_) {
                        // NB: Ensure that if the primary app gets started as elevated
                        // admin inadvertently, secondary windows running not as elevated
                        // will still be able to send messages.
                        ::ChangeWindowMessageFilterEx(impl_->hwnd_, WM_COPYDATA, MSGFLT_ALLOW, NULL);
                    }
                    return !!impl_->hwnd_;
                }
            }
        }

        return false;
    }

    bool ProcessSingleton::ProcessLaunchNotification(const void *cds) {
        return impl_->ProcessLaunchNotification(static_cast<const COPYDATASTRUCT*>(cds));
    }

    bool ProcessSingleton::Impl::ProcessLaunchNotification(const COPYDATASTRUCT *cds) {
        // We should have enough room for the shortest command (min_message_size)
        // and also be a multiple of wchar_t bytes. The shortest command
        // possible is L"START\0\0" (empty current directory and command line).
        static const int min_message_size = 7;
        if (cds->cbData < min_message_size * sizeof(wchar_t) || cds->cbData % sizeof(wchar_t) != 0) {
            // LOG(WARNING) << "Invalid WM_COPYDATA, length = " << cds->cbData;
            return false;
        }

        // We split the string into 4 parts on NULLs.
        // check(cds->lpData);
        const std::wstring msg(static_cast<wchar_t *>(cds->lpData), cds->cbData / sizeof(wchar_t));
        const std::wstring::size_type first_null = msg.find_first_of(L'\0');
        if (first_null == 0 || first_null == std::wstring::npos) {
            // no NULL byte, don't know what to do
            // LOG(WARNING) << "Invalid WM_COPYDATA, length = " << msg.length() << ", first null = " << first_null;
            return false;
        }

        // Decode the command, which is everything until the first NULL.
        if (msg.substr(0, first_null) == L"START") {
            // Another instance is starting parse the command line & do what it would
            // have done.
            // VLOG(1) << "Handling STARTUP request from another process";
            const std::wstring::size_type second_null = msg.find_first_of(L'\0', first_null + 1);
            if (second_null == std::wstring::npos || first_null == msg.length() - 1 || second_null == msg.length()) {
                // LOG(WARNING) << "Invalid format for start command, we need a string in 4 "
                //                 "parts separated by NULLs";
                return false;
            }

            // Get current directory.
            std::wstring current_directory = msg.substr(first_null + 1, second_null - first_null);

            const std::wstring::size_type third_null = msg.find_first_of(L'\0', second_null + 1);
            if (third_null == std::wstring::npos || third_null == msg.length()) {
                // LOG(WARNING) << "Invalid format for start command, we need a string in 4 "
                //                 "parts separated by NULLs";
            }

            // Get command line.
            const std::wstring cmd_line = msg.substr(second_null + 1, third_null - second_null);

            event_callback_(WStringToUTF8(cmd_line.c_str()), WStringToUTF8(current_directory.c_str()));
            return true;
        }
        return false;
    }

    // Code roughly based on Mozilla.
    NotifyResult ProcessSingleton::NotifyOtherProcess() {
        if (is_virtualized_)
            return NotifyResult::PROCESS_NOTIFIED; // We already spawned the process in this case.
        if (impl_->lock_file_ == INVALID_HANDLE_VALUE && !impl_->remote_window_) {
            return NotifyResult::LOCK_ERROR;
        } else if (!impl_->remote_window_) {
            return NotifyResult::PROCESS_NONE;
        }

        switch (DeskGap::AttemptToNotifyRunningDeskGap(impl_->remote_window_)) {
        case DeskGap::NOTIFY_SUCCESS:
            return NotifyResult::PROCESS_NOTIFIED;
        case DeskGap::NOTIFY_FAILED:
            impl_->remote_window_ = NULL;
            // internal::SendRemoteProcessInteractionResultHistogram(RUNNING_PROCESS_NOTIFY_ERROR);
            return NotifyResult::PROCESS_NONE;
        case DeskGap::NOTIFY_WINDOW_HUNG:
            // Fall through and potentially terminate the hung browser.
            break;
        }

        // The window is hung.
        DWORD process_id = 0;
        DWORD thread_id = ::GetWindowThreadProcessId(impl_->remote_window_, &process_id);
        if (!thread_id || !process_id) {
            // TRACE_EVENT_INSTANT("startup", "ProcessSingleton::NotifyOtherProcess:GetWindowThreadProcessId failed");
            impl_->remote_window_ = NULL;
            // internal::SendRemoteProcessInteractionResultHistogram(REMOTE_PROCESS_NOT_FOUND);
            return NotifyResult::PROCESS_NONE;
        }

        DWORD kBasicProcessAccess = PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | SYNCHRONIZE;

        // Get a handle to the process that created the window.
        auto process = ::OpenProcess(kBasicProcessAccess, FALSE, process_id);

        // Scan for every window to find a visible one.
        bool visible_window = false;
        {
            // TRACE_EVENT0("startup", "ProcessSingleton::NotifyOtherProcess:EnumThreadWindows");
            ::EnumThreadWindows(thread_id, &BrowserWindowEnumeration, reinterpret_cast<LPARAM>(&visible_window));
        }

        // If there is a visible browser window, ask the user before killing it.
        if (visible_window /* && !should_kill_remote_process_callback_.Run() */) {
            // internal::SendRemoteProcessInteractionResultHistogram(USER_REFUSED_TERMINATION);
            // The user denied. Quit silently.
            return NotifyResult::PROCESS_NOTIFIED;
        }
        // internal::SendRemoteHungProcessTerminateReasonHistogram(visible_window ? USER_ACCEPTED_TERMINATION : NO_VISIBLE_WINDOW_FOUND);

        // Time to take action. Kill the browser process.
        static constexpr auto RESULT_CODE_HUNG = 2;
        bool result = (::TerminateProcess(process, RESULT_CODE_HUNG) != FALSE);
        DWORD terminate_error = 0;
        if (result) {
            DWORD wait_error = 0;
            // The process may not end immediately due to pending I/O
            DWORD wait_result = ::WaitForSingleObject(process, 60 * 1000);
            if (wait_result != WAIT_OBJECT_0) {
                if (wait_result == WAIT_FAILED)
                    wait_error = ::GetLastError();
            }

            check(wait_error);
        } else {
            terminate_error = ::GetLastError();
            check(terminate_error);
        }

        impl_->remote_window_ = NULL;
        return NotifyResult::PROCESS_NONE;
    }

    // Microsoft's Softricity virtualization breaks the sandbox processes.
    // So, if we detect the Softricity DLL we use WMI Win32_Process.Create to
    // break out of the virtualization environment.
    // http://code.google.com/p/chromium/issues/detail?id=43650
    bool ProcessSingleton::EscapeVirtualization() {
        if (::GetModuleHandle(L"sftldr_wow64.dll") || ::GetModuleHandle(L"sftldr.dll")) {
            int process_id;
            if (!WmiLaunchProcess(::GetCommandLineW(), &process_id))
                return false;
            is_virtualized_ = true;
            // The new window was spawned from WMI, and won't be in the foreground.
            // So, first we sleep while the new chrome.exe instance starts (because
            // WaitForInputIdle doesn't work here). Then we poll for up to two more
            // seconds and make the window foreground if we find it (or we give up).
            HWND hwnd = 0;
            ::Sleep(90);
            for (int tries = 200; tries; --tries) {
                hwnd = DeskGap::FindRunningWindow(user_data_dir_);
                if (hwnd) {
                    ::SetForegroundWindow(hwnd);
                    break;
                }
                ::Sleep(10);
            }
            return true;
        }
        return false;
    }
} // namespace DeskGap
