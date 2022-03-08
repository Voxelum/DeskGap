#ifndef DESKGAP_TRAY_HPP
#define DESKGAP_TRAY_HPP

#include "menu.hpp"
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace DeskGap {
    class Tray {
        friend class App;

      public:
        struct EventCallbacks {
            std::function<void()> onClick;
            std::function<void()> onDoubleClick;
            std::function<void()> onRightClick;
        };

        Tray(const std::string &iconPath, const EventCallbacks &&);
        ~Tray();

        void Destroy();
        bool isDestroyed();
        void SetIcon(const std::string &iconPath);
        void PopupMenu(const Menu& menu, const std::array<int, 2>* location, int positioningItem, std::function<void()>&& onClose);
        void SetTooltip(const std::string &tooltip);
        void SetTitle(const std::string &title);
        std::string GetTitle();

      struct Impl;
      private:
        Impl *impl_;
    }; 
} // namespace DeskGap

#endif
