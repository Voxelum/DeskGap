// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef DESKGAP_PROCESS_SINGLETON_HPP
#define DESKGAP_PROCESS_SINGLETON_HPP

#include <functional>
#include <string>

namespace DeskGap {
    // Logged as histograms, do not modify these values.
    enum NotifyResult { PROCESS_NONE = 0, PROCESS_NOTIFIED = 1, PROFILE_IN_USE = 2, LOCK_ERROR = 3, LAST_VALUE = LOCK_ERROR };

#ifdef WIN32
    typedef std::wstring path_string;
#else
    typedef std::string path_string;
#endif

    using SecondInstanceEventCallback = std::function<void(const std::string &&, const std::string &&)>;
    class ProcessSingleton {
      public:
        std::string program_name_;
        path_string user_data_dir_;
        bool is_app_sandboxed_;
        bool is_virtualized_;

        ProcessSingleton(const ProcessSingleton &) = delete;
        ProcessSingleton &operator=(const ProcessSingleton &) = delete;
        ProcessSingleton(const std::string &program_name, const path_string &user_data_dir, bool is_app_sandboxed, SecondInstanceEventCallback &&);
        ~ProcessSingleton();

        void Cleanup();

        NotifyResult NotifyOtherProcessOrCreate();

        bool ProcessLaunchNotification(const void* payload);
      private:
        struct Impl;
        Impl* impl_;
        // Code roughly based on Mozilla.
        NotifyResult NotifyOtherProcess();

        bool Create();

        // Windows only function
        bool EscapeVirtualization();
    };
} // namespace DeskGap

#endif // DESKGAP_PROCESS_SINGLETON_HPP
