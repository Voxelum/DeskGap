#ifndef DESKGAP_TRAY_HPP
#define DESKGAP_TRAY_HPP

#include <string>
#include <functional>
#include <optional>
#include <utility>
#include <vector>
#include <windows.h>
#include <shellapi.h>  // NOLINT

namespace DeskGap {
    class Tray {
    public:
    Tray(HWND window);
    ~Tray();

    void Destroy();
    bool isDestroyed();
    void SetImage();
    void SetTooltip(const std::string& tooltip);
    void SetTitle(const std::string& title);
    std::string GetTitle();
    private:
    HWND _window;
    void InitIconData(NOTIFYICONDATA* icon_data);
    };
}

#endif
