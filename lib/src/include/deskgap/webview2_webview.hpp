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
        Webview2Webview(EventCallbacks&&, const std::string& preloadScriptString);
        virtual void LoadLocalFile(const std::string& path) override;
        virtual void LoadRequest(
            const std::string& method,
            const std::string& urlString,
            const std::vector<HTTPHeader>& headers,
            const std::optional<std::string>& body
        ) override;
        virtual void Reload() override;
        virtual void SetDevToolsEnabled(bool enabled) override;
        virtual void ExecuteJavaScript(const std::string& scriptString, std::optional<JavaScriptExecutionCallback>&&) override;
        virtual ~Webview2Webview();
    };
}

#endif
