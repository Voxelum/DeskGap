#ifndef DESKGAP_WEBVIEW2_WEBVIEW_HPP
#define DESKGAP_WEBVIEW2_WEBVIEW_HPP

// #ifdef DESKGAP_EXPORTING
//    #define DECLSPEC __declspec(dllexport)
// #else
//    #define DECLSPEC __declspec(dllimport)
// #endif

#include "webview.hpp"
#include <string>

namespace DeskGap {
    class Webview2Webview: public WebView {
    private:
        struct Impl;
        Impl* webview2Impl_;
    public:
        static std::string GetAvailableCoreVersion();
        Webview2Webview(
            EventCallbacks&&,
            const std::string& preloadScriptString,
            SessionOptions&&,
            std::optional<uint32_t> backgroundColor
        );
        virtual void LoadLocalFile(const std::string& path, const std::string& fragment, const std::string& applicationHost) override;
        virtual void LoadRequest(
            const std::string& method,
            const std::string& urlString,
            const std::vector<HTTPHeader>& headers,
            const std::optional<std::string>& body
        ) override;
        virtual void Reload() override;
        virtual void ResolveNavigationPolicy(uint64_t requestId, bool allow) override;
        virtual void ResolveCustomProtocolRequest(
            uint64_t requestId,
            int statusCode,
            const std::string& statusText,
            const std::vector<HTTPHeader>& headers,
            std::vector<uint8_t>&& body
        ) override;
        virtual void SetDevToolsEnabled(bool enabled) override;
        virtual void ExecuteJavaScript(const std::string& scriptString, std::optional<JavaScriptExecutionCallback>&&) override;
        virtual void TrySuspend(SuspendCallback&& callback) override;
        virtual void Resume() override;
        virtual ~Webview2Webview();
    };
}

#endif
