// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef DESKGAP_PROCESS_FINDER_HPP
#define DESKGAP_PROCESS_FINDER_HPP

#include "dispatch_wnd.hpp"
#include "util/win32_check.h"

namespace DeskGap {
    enum NotifyChromeResult {
        NOTIFY_SUCCESS,
        NOTIFY_FAILED,
        NOTIFY_WINDOW_HUNG,
    };

    // Finds an already running deskgap window if it exists.
    HWND FindRunningWindow(const std::wstring &window_name) {
        return FindWindowExW(HWND_MESSAGE, nullptr, DispatcherWndClassName, window_name.c_str());
    }

    // Attempts to send the current command line to an already running instance of
    // Chrome via a WM_COPYDATA message.
    // Returns true if a running Chrome is found and successfully notified.
    NotifyChromeResult AttemptToNotifyRunningDeskGap(HWND remote_window) {
        DWORD process_id = 0;
        DWORD thread_id = GetWindowThreadProcessId(remote_window, &process_id);
        if (!thread_id || !process_id) {
            return NOTIFY_FAILED;
        }

        // Send the command line to the remote chrome window.
        // Format is "START\0<<<current directory>>>\0<<<commandline>>>".
        std::wstring to_send(L"START\0", 6); // want the NULL in the string.
        wchar_t cur_dir[MAX_PATH];
        if (!GetCurrentDirectoryW(MAX_PATH, cur_dir)) {
            // TRACE_EVENT_INSTANT("startup", "AttemptToNotifyRunningChrome:GetCurrentDirectory failed");
            return NOTIFY_FAILED;
        }
        to_send.append(cur_dir);
        to_send.append(L"\0", 1); // Null separator.
        to_send.append(::GetCommandLineW());
        to_send.append(L"\0", 1); // Null separator.

        // Allow the current running browser window to make itself the foreground
        // window (otherwise it will just flash in the taskbar).
        ::AllowSetForegroundWindow(process_id);

        COPYDATASTRUCT cds;
        cds.dwData = 0;
        cds.cbData = static_cast<DWORD>((to_send.length() + 1) * sizeof(wchar_t));
        cds.lpData = const_cast<wchar_t *>(to_send.c_str());
        DWORD_PTR result = 0;
        {
            // TRACE_EVENT0("startup", "AttemptToNotifyRunningChrome:SendMessage");
            if (::SendMessageTimeout(remote_window, WM_COPYDATA, NULL, reinterpret_cast<LPARAM>(&cds), SMTO_ABORTIFHUNG, 20 * 1000,
                                     &result)) {
                return result ? NOTIFY_SUCCESS : NOTIFY_FAILED;
            }
        }

        // If SendMessageTimeout failed to send message consider this as
        // NOTIFY_FAILED. Timeout can be represented as either ERROR_TIMEOUT or 0...
        // https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw
        // Anecdotally which error code comes out seems to depend on whether this
        // process had non-empty data to deliver via |to_send| or not.
        const auto error = ::GetLastError();
        const bool timed_out = (error == ERROR_TIMEOUT || error == 0);
        if (!timed_out) {
            // TRACE_EVENT_INSTANT("startup", "AttemptToNotifyRunningChrome:Error SendFailed");
            return NOTIFY_FAILED;
        }

        // It is possible that the process owning this window may have died by now.
        if (!::IsWindow(remote_window)) {
            // TRACE_EVENT_INSTANT("startup", "AttemptToNotifyRunningChrome:Error RemoteDied");
            return NOTIFY_FAILED;
        }

        // If the window couldn't be notified but still exists, assume it is hung.
        // TRACE_EVENT_INSTANT("startup", "AttemptToNotifyRunningChrome:Error RemoteHung");
        return NOTIFY_WINDOW_HUNG;
    }
} // namespace DeskGap

#endif // DESKGAP_PROCESS_FINDER_HPP
