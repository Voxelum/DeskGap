#include "tray_wrap.h"
#include "../dispatch/dispatch.h"
#include "../menu/menu_wrap.h"
#include <deskgap/tray.hpp>
#include <memory>
#include <vector>

namespace DeskGap {
    void TrayWrap::SetTooltip(const Napi::CallbackInfo &info) {
        std::string tooltip = info[0].As<Napi::String>();
        UISyncDelayable(info.Env(), [this, tooltip] { this->tray_->SetTooltip(tooltip); });
    }

    void TrayWrap::SetIcon(const Napi::CallbackInfo &info) {
        std::string iconPath = info[0].As<Napi::String>();
        UISyncDelayable(info.Env(), [this, iconPath] { this->tray_->SetIcon(iconPath); });
    }

    void TrayWrap::SetTitle(const Napi::CallbackInfo &info) {
        std::string title = info[0].As<Napi::String>();
        UISyncDelayable(info.Env(), [this, title] { this->tray_->SetTitle(title); });
    }

    void TrayWrap::PopupMenu(const Napi::CallbackInfo &info) {
        Napi::Object jsMenu = info[0].As<Napi::Object>();
        MenuWrap *wrappedMenu = MenuWrap::Unwrap(jsMenu);

        std::function<void()> onClose = [jsOnClose = JSFunctionForUI::Persist(info[1].As<Napi::Function>())]() {
            jsOnClose->Call();
        };

        UISyncDelayable(info.Env(), [this, wrappedMenu, onClose = std::move(onClose)]() mutable {
            this->tray_->PopupMenu(*(wrappedMenu->menu_), nullptr, 0, std::move(onClose));
        });
    }

    void TrayWrap::SetContextMenu(const Napi::CallbackInfo &info) {
        Napi::Object jsMenuItem = info[0].As<Napi::Object>();
        MenuWrap *wrappedMenu = MenuWrap::Unwrap(jsMenuItem);

        // UISyncDelayable(info.Env(), [this, wrappedMenu] { this->tray_->SetContextMenu(*(wrappedMenu->menu_)); });
    }

    TrayWrap::TrayWrap(const Napi::CallbackInfo &info) : Napi::ObjectWrap<TrayWrap>(info) {
        std::string iconPath = info[0].As<Napi::String>();

        Napi::Object jsCallbacks = info[1].As<Napi::Object>();

        Napi::Function jsOnClick = jsCallbacks.Get("onClick").As<Napi::Function>();
        Napi::Function jsOnDoubleClick = jsCallbacks.Get("onDoubleClick").As<Napi::Function>();
        Napi::Function jsOnRightClick = jsCallbacks.Get("onRightClick").As<Napi::Function>();

        Tray::EventCallbacks eventCallbacks{
            [jsOnClick = JSFunctionForUI::Persist(jsOnClick, true)]() { jsOnClick->Call(); },
            [jsonDoubleClick = JSFunctionForUI::Persist(jsOnDoubleClick, true)]() { jsonDoubleClick->Call(); },
            [jsOnRightClick = JSFunctionForUI::Persist(jsOnRightClick, true)]() { jsOnRightClick->Call(); },
        };

        UISyncDelayable(info.Env(), [this, iconPath, eventCallbacks = std::move(eventCallbacks)]() {
            this->tray_ = std::make_unique<Tray>(iconPath, std::move(eventCallbacks));
        });
    }

    Napi::Function TrayWrap::Constructor(const Napi::Env &env) {
        return DefineClass(env, "TrayNative",
                           {
                               InstanceMethod("setIcon", &TrayWrap::SetIcon),
                               InstanceMethod("setTooltip", &TrayWrap::SetTooltip),
                               InstanceMethod("setTitle", &TrayWrap::SetTitle),
                               InstanceMethod("popupMenu", &TrayWrap::PopupMenu),
                               InstanceMethod("setContextMenu", &TrayWrap::SetContextMenu),
                           });
    }
} // namespace DeskGap
