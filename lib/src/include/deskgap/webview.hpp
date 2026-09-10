#ifndef DESKGAP_WEBVIEW_HPP
#define DESKGAP_WEBVIEW_HPP

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// On Windows the WebView class is a pure virtual interface because there are
// separate WebView2 and WinRT implementations selected at runtime.
#ifdef WIN32
    #pragma warning(disable: 4275)
    #define VIRTUAL_IF_WIN32 virtual
    #define PURE_VIRTUAL_IF_WIN32(decl) virtual decl=0
#else
    #define VIRTUAL_IF_WIN32
    #define PURE_VIRTUAL_IF_WIN32(decl) decl
    
#endif


namespace DeskGap {
    class WebView {
    protected:
        friend class BrowserWindow;
        struct Impl;
        std::unique_ptr<Impl> impl_;
    public:
        #ifdef WIN32
        static bool IsWinRTWebViewAvailable();
        static std::string GetWebview2Version();
        #endif
        struct HTTPHeader {
            std::string field;
            std::string value;
        };

        struct EventCallbacks {
            std::function<void()> didFinishLoad;
            std::function<void(const std::string&, bool)> didStartNavigation;
            std::function<void(int, const std::string&, const std::string&)> didFailLoad;
            std::function<void(uint64_t, const std::string&, bool)> onNavigationPolicyRequest;
            std::function<void(const std::string&, const std::string&, const std::string&)> onNewWindowRequested;
            std::function<void(const std::string&, int)> onRenderProcessGone;
            std::function<void(const std::string&, const std::string&)> onConsoleMessage;
            std::function<void(const std::string&)> onPageTitleUpdated;
            std::function<void(std::vector<std::string>&&)> onFilesDropped;
            std::function<void(uint64_t, const std::string&, const std::string&, std::vector<HTTPHeader>&&)> onCustomProtocolRequest;
            std::function<void(uint64_t)> onCustomProtocolRequestCancelled;
        };

        struct CustomScheme {
            std::string name;
        };

        struct SessionOptions {
            std::string id;
            std::string kind;
            std::optional<std::string> name;
            std::optional<std::string> dataPath;
            std::optional<std::string> userAgent;
            std::optional<std::string> proxyRules;
            std::optional<std::string> proxyBypassRules;
            std::vector<CustomScheme> customSchemes;
        };

        #ifndef WIN32
        WebView(EventCallbacks&&, const std::string& preloadScriptString, SessionOptions&&);
        #endif

        PURE_VIRTUAL_IF_WIN32(void LoadLocalFile(const std::string& path, const std::string& fragment, const std::string& applicationHost));
        PURE_VIRTUAL_IF_WIN32(void LoadRequest(
            const std::string& method,
            const std::string& urlString,
            const std::vector<HTTPHeader>& headers,
            const std::optional<std::string>& body
        ));
        virtual std::string GetLocalFileOrigin() { return ""; }
        PURE_VIRTUAL_IF_WIN32(void Reload());
        PURE_VIRTUAL_IF_WIN32(void ResolveNavigationPolicy(uint64_t requestId, bool allow));
        PURE_VIRTUAL_IF_WIN32(void ResolveCustomProtocolRequest(
            uint64_t requestId,
            int statusCode,
            const std::string& statusText,
            const std::vector<HTTPHeader>& headers,
            std::vector<uint8_t>&& body
        ));
        using JavaScriptExecutionCallback = std::function<void(std::optional<std::string>&&)>; // std::optional<std::string>: error message
        PURE_VIRTUAL_IF_WIN32(void ExecuteJavaScript(const std::string& scriptString, std::optional<JavaScriptExecutionCallback>&&));

        using SuspendCallback = std::function<void(bool)>;
        virtual void TrySuspend(SuspendCallback&& callback) { callback(false); }
        virtual void Resume() { }

        PURE_VIRTUAL_IF_WIN32(void SetDevToolsEnabled(bool enabled));

        #ifdef WIN32
        inline virtual ~WebView() = default;
        #else
        ~WebView();
        #endif
    };
}

#ifdef WIN32
#include "winrt_webview.hpp"
#include "webview2_webview.hpp"
#endif 

#endif
