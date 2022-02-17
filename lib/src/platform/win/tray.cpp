#include "tray.hpp"

namespace DeskGap {
    Tray::Tray(HWND window): _window(window) {
        NOTIFYICONDATA icon_data;
        InitIconData(&icon_data);
        icon_data.uFlags |= NIF_MESSAGE;
        icon_data.uCallbackMessage = message_id_;
        BOOL result = Shell_NotifyIcon(NIM_ADD, &icon_data);
        // This can happen if the explorer process isn't running when we try to
        // create the icon for some reason (for example, at startup).
        if (!result)
            LOG(WARNING) << "Unable to create status tray icon.";
    }
    
    void Tray::InitIconData(NOTIFYICONDATA* icon_data) {
        memset(icon_data, 0, sizeof(NOTIFYICONDATA));
        icon_data->cbSize = sizeof(NOTIFYICONDATA);
        icon_data->hWnd = _window;
        icon_data->uID = icon_id_;
        if (is_using_guid_) {
            icon_data->uFlags = NIF_GUID;
            icon_data->guidItem = guid_;
        }
    }
} // namespace DeskGap
