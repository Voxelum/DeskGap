#ifndef DESKGAP_WIN_WINDOW_MESSAGES_H
#define DESKGAP_WIN_WINDOW_MESSAGES_H

#include <Windows.h>

namespace DeskGap {
    constexpr UINT WindowControlMessage = WM_APP + 43;

    enum class WindowControlAction : WPARAM {
        Minimize = 1,
        ToggleMaximize = 2,
        Close = 3,
    };
}

#endif
