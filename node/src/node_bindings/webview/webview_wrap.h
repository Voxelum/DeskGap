#ifndef webview_webview_wrap_h
#define webview_webview_wrap_h

#include <napi.h>
#include <functional>
#include <memory>
#include <deskgap/webview.hpp>

namespace DeskGap {
    class WebViewWrap: public Napi::ObjectWrap<WebViewWrap> {
    private:
        friend class BrowserWindowWrap;
        std::unique_ptr<WebView> webview_;
        void LoadLocalFile(const Napi::CallbackInfo& info);
        void LoadRequest(const Napi::CallbackInfo& info);
        void ExecuteJavaScript(const Napi::CallbackInfo& info);
        void Reload(const Napi::CallbackInfo&);
        void SetDevToolsEnabled(const Napi::CallbackInfo& info);
        void Destroy(const Napi::CallbackInfo& info);
        #ifdef WIN32
        enum class Engine: uint32_t {
            TRIDENT = 0, WINRT = 1, WEBVIEW2 = 2
        };
        static Napi::Value IsWinRTEngineAvailable(const Napi::CallbackInfo& info);
        static Napi::Value GetWebview2Version(const Napi::CallbackInfo& info);
        #endif
    public:
        WebViewWrap(const Napi::CallbackInfo& info);
        static Napi::Function Constructor(const Napi::Env& env);
    };
}

#endif
