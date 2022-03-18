#ifndef DESKGAP_PROCESS_SINGLETON_IMPL_HPP
#define DESKGAP_PROCESS_SINGLETON_IMPL_HPP

#include "process_singleton.hpp"
#include <Windows.h>

namespace DeskGap {
#ifdef WIN32
    typedef const COPYDATASTRUCT *MessagePayload;
#else
    typedef char *MessagePayload;
#endif

    struct ProcessSingleton::Impl {
        // The current stub window handle
        HWND hwnd_;
        // The another instance stub window handle
        HWND remote_window_;
        HANDLE lock_file_;

        SecondInstanceEventCallback event_callback_;

        Impl(SecondInstanceEventCallback &&);

        bool ProcessLaunchNotification(MessagePayload payload);
    };
} // namespace DeskGap

#endif
