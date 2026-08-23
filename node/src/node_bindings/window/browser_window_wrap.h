#ifndef browser_browser_window_wrap_h
#define browser_browser_window_wrap_h

#include <napi.h>
#include <functional>
#include <deskgap/browser_window.hpp>

namespace DeskGap {
    class BrowserWindowWrap: public Napi::ObjectWrap<BrowserWindowWrap> {
    private:
        std::unique_ptr<BrowserWindow> browser_window_;
        void Show(const Napi::CallbackInfo& info);
        void SetSize(const Napi::CallbackInfo& info);
        void SetContentSize(const Napi::CallbackInfo& info);
        void SetPosition(const Napi::CallbackInfo& info);
        void SetMaximumSize(const Napi::CallbackInfo& info);
        void SetMinimumSize(const Napi::CallbackInfo& info);
        void SetAspectRatio(const Napi::CallbackInfo& info);
        Napi::Value GetNativeWindowHandle(const Napi::CallbackInfo& info);
        void SetTitle(const Napi::CallbackInfo& info);
        Napi::Value GetSize(const Napi::CallbackInfo& info);
        Napi::Value GetContentSize(const Napi::CallbackInfo& info);
        Napi::Value GetPosition(const Napi::CallbackInfo& info);
        void Center(const Napi::CallbackInfo& info);
        void Destroy(const Napi::CallbackInfo& info);
        void Close(const Napi::CallbackInfo& info);
        void PopupMenu(const Napi::CallbackInfo& info);

    #ifndef __APPLE__
        void SetMenu(const Napi::CallbackInfo& info);
        void SetAutoHideMenuBar(const Napi::CallbackInfo& info);
        Napi::Value IsMenuBarAutoHide(const Napi::CallbackInfo& info);
        void SetMenuBarVisibility(const Napi::CallbackInfo& info);
        Napi::Value IsMenuBarVisible(const Napi::CallbackInfo& info);
        void SetIcon(const Napi::CallbackInfo& info);
    #endif

    #ifdef __APPLE__
        void SetTitleBarStyle(const Napi::CallbackInfo& info);
        void SetTrafficLightPosition(const Napi::CallbackInfo& info);
        void SetVibrancies(const Napi::CallbackInfo& info);
    #endif

    #ifdef WIN32
        void SetBackgroundMaterial(const Napi::CallbackInfo& info);
    #endif

        void SetMaximizable(const Napi::CallbackInfo& info);
        void SetMinimizable(const Napi::CallbackInfo& info);
        void SetResizable(const Napi::CallbackInfo& info);
        void SetHasFrame(const Napi::CallbackInfo& info);
        void SetClosable(const Napi::CallbackInfo& info);
        void SetTransparent(const Napi::CallbackInfo& info);
        void SetHasShadow(const Napi::CallbackInfo& info);
        void SetParent(const Napi::CallbackInfo& info);
        void SetModal(const Napi::CallbackInfo& info);
        void Minimize(const Napi::CallbackInfo& info);
        void Restore(const Napi::CallbackInfo& info);
        void Maximize(const Napi::CallbackInfo& info);
        void Unmaximize(const Napi::CallbackInfo& info);
        void Hide(const Napi::CallbackInfo& info);
        void Focus(const Napi::CallbackInfo& info);
        Napi::Value IsVisible(const Napi::CallbackInfo& info);
        Napi::Value IsFocused(const Napi::CallbackInfo& info);
        Napi::Value IsMinimized(const Napi::CallbackInfo& info);
        Napi::Value IsMaximized(const Napi::CallbackInfo& info);
        void SetFullScreen(const Napi::CallbackInfo& info);
        Napi::Value IsFullScreen(const Napi::CallbackInfo& info);
        void FlashFrame(const Napi::CallbackInfo& info);
    public:
        BrowserWindowWrap(const Napi::CallbackInfo& info);
        static Napi::Function Constructor(Napi::Env env);
        std::reference_wrapper<BrowserWindow> UnderlyingObject();
    };
}

#endif
