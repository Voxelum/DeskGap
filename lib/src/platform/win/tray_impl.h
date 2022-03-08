#ifndef win_tray_impl_h
#define win_tray_impl_h

#include <Windows.h>
#include <functional>
#include <optional>
#include <queue>
#include <shellapi.h>
#include <vector>

#include "tray.hpp"

namespace DeskGap {
    LRESULT OnTrayClick(WPARAM wp, LPARAM lp);

    std::vector<DeskGap::Tray::Impl *> tray_instances_;

    struct Tray::Impl {
        friend class App;
        friend class Tray;

        void SetIcon(const std::string &iconPath);
        void SetTooltip(const std::string &tooltip);
        void OnClick(LPARAM lp);

        Impl(const EventCallbacks &&);
        ~Impl();

        UINT icon_id_;
        EventCallbacks callbacks_;
      private:
        void Remove();
        void InitIconData(NOTIFYICONDATA *icon_data);
        // The global trays, which are consumed by app while message received
    };
} // namespace DeskGap

#endif
