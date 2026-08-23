#include <memory>
#include "browser_window_wrap.h"
#include "../menu/menu_wrap.h"
#include "../webview/webview_wrap.h"
#include <deskgap/browser_window.hpp>
#include "../dispatch/dispatch.h"

namespace DeskGap {
    void BrowserWindowWrap::Show(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this]() {
            this->browser_window_->Show();
        });
    }
    void BrowserWindowWrap::SetSize(const Napi::CallbackInfo& info) {
        int width = info[0].As<Napi::Number>();
        int height = info[1].As<Napi::Number>();
        bool animate = info[2].As<Napi::Boolean>();

        UISyncDelayable(info.Env(), [
            this, width, height, animate
        ] {
            this->browser_window_->SetSize(width, height, animate);
        });
    }

    void BrowserWindowWrap::SetContentSize(const Napi::CallbackInfo& info) {
        int width = info[0].As<Napi::Number>();
        int height = info[1].As<Napi::Number>();
        bool animate = info[2].As<Napi::Boolean>();
        UISyncDelayable(info.Env(), [this, width, height, animate] {
            this->browser_window_->SetContentSize(width, height, animate);
        });
    }

    void BrowserWindowWrap::SetPosition(const Napi::CallbackInfo& info) {
        int x = info[0].As<Napi::Number>();
        int y = info[1].As<Napi::Number>();
        bool animate = info[2].As<Napi::Boolean>();

        UISyncDelayable(info.Env(), [
            this, x, y, animate
        ] {
            this->browser_window_->SetPosition(x, y, animate);
        });
    }

    void BrowserWindowWrap::SetMaximumSize(const Napi::CallbackInfo& info) {
        int width = info[0].As<Napi::Number>();
        int height = info[1].As<Napi::Number>();

        UISyncDelayable(info.Env(), [this, width, height] {
            this->browser_window_->SetMaximumSize(width, height);
        });
    }

    void BrowserWindowWrap::SetMinimumSize(const Napi::CallbackInfo& info) {
        int width = info[0].As<Napi::Number>();
        int height = info[1].As<Napi::Number>();

        UISyncDelayable(info.Env(), [this, width, height] {
            this->browser_window_->SetMinimumSize(width, height);
        });
    }

    void BrowserWindowWrap::SetAspectRatio(const Napi::CallbackInfo& info) {
        double ratio = info[0].As<Napi::Number>().DoubleValue();
        int extraWidth = info[1].As<Napi::Number>().Int32Value();
        int extraHeight = info[2].As<Napi::Number>().Int32Value();
        UISyncDelayable(info.Env(), [this, ratio, extraWidth, extraHeight] {
            this->browser_window_->SetAspectRatio(ratio, extraWidth, extraHeight);
        });
    }

    Napi::Value BrowserWindowWrap::GetNativeWindowHandle(const Napi::CallbackInfo& info) {
        std::vector<uint8_t> bytes;
        UISync(info.Env(), [this, &bytes] { bytes = this->browser_window_->GetNativeWindowHandle(); });
        return Napi::Buffer<uint8_t>::Copy(info.Env(), bytes.data(), bytes.size());
    }

    void BrowserWindowWrap::SetTitle(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, utf8title = info[0].As<Napi::String>().Utf8Value()] {
            this->browser_window_->SetTitle(utf8title);
        });
    }

    Napi::Value BrowserWindowWrap::GetSize(const Napi::CallbackInfo& info) {
        std::array<int, 2> size;
        UISync(info.Env(), [this, &size]() {
            size = this->browser_window_->GetSize();
        });
        Napi::Array jsSize = Napi::Array::New(info.Env(), 2);
        jsSize.Set((uint32_t)0, Napi::Number::New(info.Env(), size[0]));
        jsSize.Set((uint32_t)1, Napi::Number::New(info.Env(), size[1]));
        return jsSize;
    }

    Napi::Value BrowserWindowWrap::GetContentSize(const Napi::CallbackInfo& info) {
        std::array<int, 2> size;
        UISync(info.Env(), [this, &size]() { size = this->browser_window_->GetContentSize(); });
        Napi::Array result = Napi::Array::New(info.Env(), 2);
        result.Set((uint32_t)0, size[0]);
        result.Set((uint32_t)1, size[1]);
        return result;
    }

    Napi::Value BrowserWindowWrap::GetPosition(const Napi::CallbackInfo& info) {
        std::array<int, 2> position;
        UISync(info.Env(), [this, &position]() {
            position = this->browser_window_->GetPosition();
        });
        Napi::Array jsPosition = Napi::Array::New(info.Env(), 2);
        jsPosition.Set((uint32_t)0, Napi::Number::New(info.Env(), position[0]));
        jsPosition.Set((uint32_t)1, Napi::Number::New(info.Env(), position[1]));
        return jsPosition;
    }

    void BrowserWindowWrap::Center(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] {
            this->browser_window_->Center();
        });
    }

    void BrowserWindowWrap::Destroy(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { 
            this->browser_window_->Destroy();
            this->browser_window_.reset();
        });
    }

    void BrowserWindowWrap::Close(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Close(); });
    }

    void BrowserWindowWrap::PopupMenu(const Napi::CallbackInfo& info) {
        MenuWrap* menuWrap = MenuWrap::Unwrap(info[0].As<Napi::Object>());
        std::array<int, 2> location;

        Napi::Value jsLocation = info[1];
        bool hasLocation = !jsLocation.IsNull();
        if (hasLocation) {
            Napi::Array jsArrayLocation = jsLocation.As<Napi::Array>();
            location = {
                jsArrayLocation.Get((uint32_t)0).As<Napi::Number>(),
                jsArrayLocation.Get((uint32_t)1).As<Napi::Number>()
            };
        }
        int positioningItem = info[2].As<Napi::Number>();
        std::function<void()> onClose = [jsOnClose = JSFunctionForUI::Persist(info[3].As<Napi::Function>())]() {
            jsOnClose->Call();
        };
        UISyncDelayable(info.Env(), [this, menuWrap, hasLocation, location, positioningItem, onClose = std::move(onClose)]() mutable {
            this->browser_window_->PopupMenu(*(menuWrap->menu_), hasLocation ? &location: nullptr, positioningItem, std::move(onClose));
        });
    }

#ifndef __APPLE__
    void BrowserWindowWrap::SetMenu(const Napi::CallbackInfo& info) {
        MenuWrap* menuWrap = nullptr;
        if (!info[0].IsNull()) {
            menuWrap = MenuWrap::Unwrap(info[0].As<Napi::Object>());
        }
        UISyncDelayable(info.Env(), [this, menuWrap] {
            this->browser_window_->SetMenu((menuWrap == nullptr) ? nullptr: menuWrap->menu_.get());
        });
    }
    void BrowserWindowWrap::SetAutoHideMenuBar(const Napi::CallbackInfo& info) {
        bool autoHide = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, autoHide] {
            this->browser_window_->SetAutoHideMenuBar(autoHide);
        });
    }
    Napi::Value BrowserWindowWrap::IsMenuBarAutoHide(const Napi::CallbackInfo& info) {
        bool autoHide = false;
        UISync(info.Env(), [this, &autoHide] { autoHide = this->browser_window_->IsMenuBarAutoHide(); });
        return Napi::Boolean::New(info.Env(), autoHide);
    }
    void BrowserWindowWrap::SetMenuBarVisibility(const Napi::CallbackInfo& info) {
        bool visible = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, visible] {
            this->browser_window_->SetMenuBarVisibility(visible);
        });
    }
    Napi::Value BrowserWindowWrap::IsMenuBarVisible(const Napi::CallbackInfo& info) {
        bool visible = false;
        UISync(info.Env(), [this, &visible] { visible = this->browser_window_->IsMenuBarVisible(); });
        return Napi::Boolean::New(info.Env(), visible);
    }
    void BrowserWindowWrap::SetIcon(const Napi::CallbackInfo& info) {
        Napi::Value jsIconPath = info[0];
        std::optional<std::string> iconPath;
        if (!jsIconPath.IsNull()) {
            iconPath = jsIconPath.As<Napi::String>().Utf8Value();
        }
        UISyncDelayable(info.Env(), [this, iconPath] {
            this->browser_window_->SetIcon(iconPath);
        });
    }
#endif

#ifdef __APPLE__
    void BrowserWindowWrap::SetTitleBarStyle(const Napi::CallbackInfo& info) {
        auto titleBarStyle = static_cast<BrowserWindow::TitleBarStyle>(info[0].As<Napi::Number>().Int32Value());
        UISyncDelayable(info.Env(), [this, titleBarStyle] {
            this->browser_window_->SetTitleBarStyle(titleBarStyle);
        });
    }

    void BrowserWindowWrap::SetTrafficLightPosition(const Napi::CallbackInfo& info) {
        int x = info[0].As<Napi::Number>().Int32Value();
        int y = info[1].As<Napi::Number>().Int32Value();
        UISyncDelayable(info.Env(), [this, x, y] {
            this->browser_window_->SetTrafficLightPosition(x, y);
        });
    }

    void BrowserWindowWrap::SetVibrancies(const Napi::CallbackInfo& info) {
        using Vibrancy = BrowserWindow::Vibrancy;
        using Constraint = Vibrancy::Constraint;
        using Unit = Constraint::Unit;

        Napi::Array jsVibrancies = info[0].As<Napi::Array>();
        uint32_t vCount = jsVibrancies.Length();

        std::vector<Vibrancy> vibrancies;
        for (uint32_t iv = 0; iv < vCount; ++iv) {
            Napi::Array jsVibrancy = jsVibrancies.Get(iv).As<Napi::Array>();

            BrowserWindow::Vibrancy v {
                jsVibrancy.Get((uint32_t)0).As<Napi::String>(), //material
                jsVibrancy.Get((uint32_t)1).As<Napi::String>(), //blendingMode
                jsVibrancy.Get((uint32_t)2).As<Napi::String>(), //state
                { }
            };

            Napi::Array jsConstraints = jsVibrancy.Get((uint32_t)3).As<Napi::Array>();
            for (uint32_t ic = 0; ic < 4; ++ic) {
                Napi::Array jsConstraint = jsConstraints.Get((uint32_t)ic).As<Napi::Array>();

                v.constraints[ic] = {
                    jsConstraint.Get((uint32_t)0).As<Napi::String>(), //attribute
                    jsConstraint.Get((uint32_t)1).As<Napi::Number>(), //value
                    jsConstraint.Get((uint32_t)2).As<Napi::Boolean>().Value() ? //unit
                        Unit::POINT : Unit::PERCENTAGE
                };
            }

            vibrancies.push_back(v);
        }

        UISyncDelayable(info.Env(), [this, vibrancies] {
            this->browser_window_->SetVibrancies(vibrancies);
        });
    }
#endif

#ifdef WIN32
    void BrowserWindowWrap::SetBackgroundMaterial(const Napi::CallbackInfo& info) {
        int material = info[0].As<Napi::Number>().Int32Value();
        bool success;
        UISync(info.Env(), [this, material, &success] {
            success = this->browser_window_->SetBackgroundMaterial(material);
        });
        if (!success) {
            Napi::Error::New(info.Env(), "Background material is not supported on this Windows version").ThrowAsJavaScriptException();
        }
    }
#endif

    void BrowserWindowWrap::SetMaximizable(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, maximizable = info[0].As<Napi::Boolean>().Value()] {
            this->browser_window_->SetMaximizable(maximizable);
        });
    }
    void BrowserWindowWrap::SetMinimizable(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, minimizable = info[0].As<Napi::Boolean>().Value()] {
            this->browser_window_->SetMinimizable(minimizable);
        });
    }
    void BrowserWindowWrap::SetResizable(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, resizable = info[0].As<Napi::Boolean>().Value()] {
            this->browser_window_->SetResizable(resizable);
        });
    }
    void BrowserWindowWrap::SetHasFrame(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, hasFrame = info[0].As<Napi::Boolean>().Value()] {
            this->browser_window_->SetHasFrame(hasFrame);
        });
    }
    void BrowserWindowWrap::SetClosable(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this, closable = info[0].As<Napi::Boolean>().Value()] {
            this->browser_window_->SetClosable(closable);
        });
    }

    void BrowserWindowWrap::SetTransparent(const Napi::CallbackInfo& info) {
        bool transparent = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, transparent] { this->browser_window_->SetTransparent(transparent); });
    }

    void BrowserWindowWrap::SetHasShadow(const Napi::CallbackInfo& info) {
        bool hasShadow = info[0].As<Napi::Boolean>().Value();
        bool success;
        UISync(info.Env(), [this, hasShadow, &success] { success = this->browser_window_->SetHasShadow(hasShadow); });
        if (!success) Napi::Error::New(info.Env(), "Window shadow control is not supported on this platform").ThrowAsJavaScriptException();
    }

    void BrowserWindowWrap::SetParent(const Napi::CallbackInfo& info) {
        BrowserWindowWrap* parent = info[0].IsNull()
            ? nullptr
            : BrowserWindowWrap::Unwrap(info[0].As<Napi::Object>());
        UISyncDelayable(info.Env(), [this, parent] {
            this->browser_window_->SetParent(parent == nullptr ? nullptr : parent->browser_window_.get());
        });
    }

    void BrowserWindowWrap::SetModal(const Napi::CallbackInfo& info) {
        bool modal = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, modal] { this->browser_window_->SetModal(modal); });
    }

    void BrowserWindowWrap::Minimize(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] {
            this->browser_window_->Minimize();
        });
    }

    void BrowserWindowWrap::Restore(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Restore(); });
    }

    void BrowserWindowWrap::Maximize(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Maximize(); });
    }

    void BrowserWindowWrap::Unmaximize(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Unmaximize(); });
    }

    void BrowserWindowWrap::Hide(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Hide(); });
    }

    void BrowserWindowWrap::Focus(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this] { this->browser_window_->Focus(); });
    }

    Napi::Value BrowserWindowWrap::IsVisible(const Napi::CallbackInfo& info) {
        bool value;
        UISync(info.Env(), [this, &value] { value = this->browser_window_->IsVisible(); });
        return Napi::Boolean::New(info.Env(), value);
    }

    Napi::Value BrowserWindowWrap::IsFocused(const Napi::CallbackInfo& info) {
        bool value;
        UISync(info.Env(), [this, &value] { value = this->browser_window_->IsFocused(); });
        return Napi::Boolean::New(info.Env(), value);
    }

    Napi::Value BrowserWindowWrap::IsMinimized(const Napi::CallbackInfo& info) {
        bool value;
        UISync(info.Env(), [this, &value] { value = this->browser_window_->IsMinimized(); });
        return Napi::Boolean::New(info.Env(), value);
    }

    Napi::Value BrowserWindowWrap::IsMaximized(const Napi::CallbackInfo& info) {
        bool value;
        UISync(info.Env(), [this, &value] { value = this->browser_window_->IsMaximized(); });
        return Napi::Boolean::New(info.Env(), value);
    }

    void BrowserWindowWrap::SetFullScreen(const Napi::CallbackInfo& info) {
        bool fullScreen = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, fullScreen] { this->browser_window_->SetFullScreen(fullScreen); });
    }

    Napi::Value BrowserWindowWrap::IsFullScreen(const Napi::CallbackInfo& info) {
        bool value;
        UISync(info.Env(), [this, &value] { value = this->browser_window_->IsFullScreen(); });
        return Napi::Boolean::New(info.Env(), value);
    }

    void BrowserWindowWrap::FlashFrame(const Napi::CallbackInfo& info) {
        bool flash = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, flash] { this->browser_window_->FlashFrame(flash); });
    }

    BrowserWindowWrap::BrowserWindowWrap(const Napi::CallbackInfo& info):
        Napi::ObjectWrap<BrowserWindowWrap>(info)
    {
        WebViewWrap* webViewWrap = WebViewWrap::Unwrap(info[0].As<Napi::Object>());
        Napi::Object jsCallbacks = info[1].As<Napi::Object>();

        BrowserWindow::EventCallbacks callbacks {
            [jsOnBlur = JSFunctionForUI::Persist(jsCallbacks.Get("onBlur").As<Napi::Function>())]() {
                jsOnBlur->Call();
            },
            [jsOnFocus = JSFunctionForUI::Persist(jsCallbacks.Get("onFocus").As<Napi::Function>())]() {
                jsOnFocus->Call();
            },
            [jsOnResize = JSFunctionForUI::Persist(jsCallbacks.Get("onResize").As<Napi::Function>())]() {
                jsOnResize->Call();
            },
            [jsOnMove = JSFunctionForUI::Persist(jsCallbacks.Get("onMove").As<Napi::Function>())]() {
                jsOnMove->Call();
            },
            [jsOnClose = JSFunctionForUI::Persist(jsCallbacks.Get("onClose").As<Napi::Function>())]() {
                jsOnClose->Call();
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onMaximize").As<Napi::Function>())]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onUnmaximize").As<Napi::Function>())]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onMinimize").As<Napi::Function>())]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onRestore").As<Napi::Function>())]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onEnterFullScreen").As<Napi::Function>())]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onLeaveFullScreen").As<Napi::Function>())]() { callback->Call(); }
        };
        UISyncDelayable(info.Env(), [this, webViewWrap, callbacks = std::move(callbacks)]() mutable {
            this->browser_window_ = std::make_unique<BrowserWindow>(*(webViewWrap->webview_), std::move(callbacks));
        });
    }
    Napi::Function BrowserWindowWrap::Constructor(Napi::Env env) {
        return DefineClass(env, "BrowserWindowNative", {
            InstanceMethod("show", &BrowserWindowWrap::Show),
            InstanceMethod("setSize", &BrowserWindowWrap::SetSize),
            InstanceMethod("setContentSize", &BrowserWindowWrap::SetContentSize),
            InstanceMethod("setMaximumSize", &BrowserWindowWrap::SetMaximumSize),
            InstanceMethod("setMinimumSize", &BrowserWindowWrap::SetMinimumSize),
            InstanceMethod("setAspectRatio", &BrowserWindowWrap::SetAspectRatio),
            InstanceMethod("getNativeWindowHandle", &BrowserWindowWrap::GetNativeWindowHandle),
            InstanceMethod("setPosition", &BrowserWindowWrap::SetPosition),
            InstanceMethod("setTitle", &BrowserWindowWrap::SetTitle),
            InstanceMethod("center", &BrowserWindowWrap::Center),
            InstanceMethod("getPosition", &BrowserWindowWrap::GetPosition),
            InstanceMethod("getSize", &BrowserWindowWrap::GetSize),
            InstanceMethod("getContentSize", &BrowserWindowWrap::GetContentSize),
            InstanceMethod("destroy", &BrowserWindowWrap::Destroy),
            InstanceMethod("close", &BrowserWindowWrap::Close),
        #ifndef __APPLE__
            InstanceMethod("setMenu", &BrowserWindowWrap::SetMenu),
            InstanceMethod("setAutoHideMenuBar", &BrowserWindowWrap::SetAutoHideMenuBar),
            InstanceMethod("isMenuBarAutoHide", &BrowserWindowWrap::IsMenuBarAutoHide),
            InstanceMethod("setMenuBarVisibility", &BrowserWindowWrap::SetMenuBarVisibility),
            InstanceMethod("isMenuBarVisible", &BrowserWindowWrap::IsMenuBarVisible),
            InstanceMethod("setIcon", &BrowserWindowWrap::SetIcon),
        #endif
        #ifdef __APPLE__
            InstanceMethod("setTitleBarStyle", &BrowserWindowWrap::SetTitleBarStyle),
            InstanceMethod("setTrafficLightPosition", &BrowserWindowWrap::SetTrafficLightPosition),
            InstanceMethod("setVibrancies", &BrowserWindowWrap::SetVibrancies),
        #endif
        #ifdef WIN32
            InstanceMethod("setBackgroundMaterial", &BrowserWindowWrap::SetBackgroundMaterial),
        #endif
            InstanceMethod("popupMenu", &BrowserWindowWrap::PopupMenu),
            InstanceMethod("setMaximizable", &BrowserWindowWrap::SetMaximizable),
            InstanceMethod("setMinimizable", &BrowserWindowWrap::SetMinimizable),
            InstanceMethod("setResizable", &BrowserWindowWrap::SetResizable),
            InstanceMethod("setHasFrame", &BrowserWindowWrap::SetHasFrame),
            InstanceMethod("setClosable", &BrowserWindowWrap::SetClosable),
            InstanceMethod("setTransparent", &BrowserWindowWrap::SetTransparent),
            InstanceMethod("setHasShadow", &BrowserWindowWrap::SetHasShadow),
            InstanceMethod("setParent", &BrowserWindowWrap::SetParent),
            InstanceMethod("setModal", &BrowserWindowWrap::SetModal),
            InstanceMethod("minimize", &BrowserWindowWrap::Minimize),
            InstanceMethod("restore", &BrowserWindowWrap::Restore),
            InstanceMethod("maximize", &BrowserWindowWrap::Maximize),
            InstanceMethod("unmaximize", &BrowserWindowWrap::Unmaximize),
            InstanceMethod("hide", &BrowserWindowWrap::Hide),
            InstanceMethod("focus", &BrowserWindowWrap::Focus),
            InstanceMethod("isVisible", &BrowserWindowWrap::IsVisible),
            InstanceMethod("isFocused", &BrowserWindowWrap::IsFocused),
            InstanceMethod("isMinimized", &BrowserWindowWrap::IsMinimized),
            InstanceMethod("isMaximized", &BrowserWindowWrap::IsMaximized),
            InstanceMethod("setFullScreen", &BrowserWindowWrap::SetFullScreen),
            InstanceMethod("isFullScreen", &BrowserWindowWrap::IsFullScreen),
            InstanceMethod("flashFrame", &BrowserWindowWrap::FlashFrame),
        });
    }
    std::reference_wrapper<BrowserWindow> BrowserWindowWrap::UnderlyingObject() {
        return *browser_window_;
    }
}
