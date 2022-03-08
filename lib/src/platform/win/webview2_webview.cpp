
#include <cstdlib>
#include <stdexcept>

#include <wil/com.h>
#include <wrl.h>

#include "WebView2.h"

#include "webview.hpp"
#include "webview_impl.h"

#include "webview2_webview.hpp"

#include "./util/wstring_utf8.h"

extern "C" {
    extern char BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT[];
    extern int BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE;
}

namespace DeskGap {
    std::string Webview2Webview::GetAvailableCoreVersion() {
        LPWSTR version = nullptr;
        if (SUCCEEDED(GetAvailableCoreWebView2BrowserVersionString(nullptr, &version))) {
            if (version == nullptr) {
                return "";
            }
            return WStringToUTF8(version);
        }
        return "";
    }

    using namespace Microsoft::WRL;

    struct Webview2Webview::Impl : public WebView::Impl {
        wil::com_ptr<ICoreWebView2Controller> webviewController;
        wil::com_ptr<ICoreWebView2> webviewWindow;
        HWND containerWnd;
        WebView::EventCallbacks callbacks;
        std::wstring preloadScript;
        std::string pathUrl = "";

        virtual void SetRect(int x, int y, int width, int height) override {
            RECT rect = {
                (long)x,
                (long)y,
                (long)x + width,
                (long)y + height,
            };
            if (webviewController) {
                webviewController->put_Bounds(rect);
            }
        }

        virtual void InitWithParent(HWND hWnd) override {
            CreateCoreWebView2EnvironmentWithOptions(
                nullptr, nullptr, nullptr,
                Callback<
                    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                    [hWnd, this](HRESULT result,
                                 ICoreWebView2Environment *env) -> HRESULT {
                        // Create a CoreWebView2Controller and get the
                        // associated CoreWebView2 whose parent is the main
                        // window hWnd
                        env->CreateCoreWebView2Controller(
                            hWnd,
                            Callback<
                                ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                [hWnd, this](HRESULT result,
                                             ICoreWebView2Controller
                                                 *controller) -> HRESULT {
                                    if (controller != nullptr) {
                                        this->webviewController = controller;
                                        this->webviewController
                                            ->get_CoreWebView2(&webviewWindow);
                                    }

                                    // Add a few settings for the webview
                                    // The demo step is redundant since the
                                    // values are the default settings
                                    ICoreWebView2Settings *Settings;
                                    webviewWindow->get_Settings(&Settings);
                                    Settings->put_IsScriptEnabled(TRUE);
                                    Settings
                                        ->put_AreDefaultScriptDialogsEnabled(
                                            TRUE);
                                    Settings->put_IsWebMessageEnabled(TRUE);

                                    // Resize the WebView2 control to fit the
                                    // bounds of the parent window
                                    RECT bounds;
                                    GetClientRect(hWnd, &bounds);
                                    webviewController->put_Bounds(bounds);

                                    if (pathUrl.length() > 0) {
                                        const auto pathUrl =
                                            "file:///" + this->pathUrl;
                                        std::wstring wpath =
                                            UTF8ToWString(pathUrl.c_str());
                                        webviewWindow->Navigate(wpath.c_str());
                                    }

                                    EventRegistrationToken token;
                                    // VARIANT remoteObjectAsVariant = {};

                                    // webviewWindow->AddHostObjectToScript(
                                    //     L"eventForwarder",
                                    //     &remoteObjectAsVariant);
                                    webviewWindow->add_NavigationCompleted(
                                        Callback<
                                            ICoreWebView2NavigationCompletedEventHandler>(
                                            [this](
                                                ICoreWebView2 *sender,
                                                ICoreWebView2NavigationCompletedEventArgs
                                                    *args) -> HRESULT {
                                                // make visible
                                                webviewController
                                                    ->put_IsVisible(true);

                                                this->callbacks.didFinishLoad();
                                                return S_OK;
                                            })
                                            .Get(),
                                        &token);
                                    // 4 - Navigation events

                                    // 5 - Scripting

                                    // 6 - Communication between host and web
                                    // webviewWindow->add_WebMessageReceived(
                                    //     Callback<
                                    //         ICoreWebView2WebMessageReceivedEventHandler>(
                                    //         [this](
                                    //             ICoreWebView2 *webview,
                                    //             ICoreWebView2WebMessageReceivedEventArgs
                                    //                 *args) -> HRESULT {
                                    //             PWSTR message;
                                    //             args->TryGetWebMessageAsString(
                                    //                 &message);
                                    //             this->callbacks.onStringMessage(
                                    //                 WStringToUTF8(message));
                                    //             CoTaskMemFree(message);
                                    //             return S_OK;
                                    //         })
                                    //         .Get(),
                                    //     &token);

                                    // webviewWindow->add_DocumentTitleChanged(
                                    //     Callback<
                                    //         ICoreWebView2DocumentTitleChangedEventHandler>(
                                    //         [this](ICoreWebView2 *webview,
                                    //                IUnknown *args) {
                                    //             wil::unique_cotaskmem_string
                                    //                 title;
                                    //             webview->get_DocumentTitle(
                                    //                 &title);
                                    //             this->callbacks
                                    //                 .onPageTitleUpdated(
                                    //                     WStringToUTF8(
                                    //                         title.get()));
                                    //         })
                                    //         .Get(),
                                    //     &token);

                                    // webviewWindow
                                    //     ->AddScriptToExecuteOnDocumentCreated(
                                    //         L"window.chrome.webview."
                                    //         L"addEventListener(\'message\', "
                                    //         L"event => alert(event.data));"
                                    //         L"window.chrome.webview."
                                    //         L"postMessage(window.document.URL)"
                                    //         L";",
                                    //         nullptr);

                                    return S_OK;
                                })
                                .Get());
                        return S_OK;
                    })
                    .Get());
        }

        Impl(WebView::EventCallbacks &callbacks, std::wstring &preload)
            : callbacks(std::move(callbacks)), containerWnd(nullptr), preloadScript(std::move(preload)) {}

        void
        ExecuteJavaScript(const std::wstring &code,
                          std::optional<JavaScriptExecutionCallback> &&cb) {
            webviewWindow->ExecuteScript(
                code.c_str(),
                Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                    [cb](HRESULT errorCode,
                         LPCWSTR resultObjectAsJson) -> HRESULT {
                        if (FAILED(errorCode)) {
                            return errorCode;
                        }
                        if (cb.has_value()) {
                            std::optional<std::string> resultMessage;
                            resultMessage.emplace(
                                WStringToUTF8(resultObjectAsJson));
                            (*cb)(std::move(resultMessage));
                        }
                        return S_OK;
                    })
                    .Get());
        }

        ~Impl() {}
    };

    Webview2Webview::Webview2Webview(EventCallbacks &&callbacks,
                                     const std::string &preloadScriptString) {

        std::string script;
        script.reserve(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE +
                       preloadScriptString.size());
        script.assign(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT,
                      BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE);
        script.append(preloadScriptString);

        auto impl = std::make_unique<Impl>(callbacks, UTF8ToWString(script.c_str()));

        // impl_ for reference owning, and winrtImpl_ for method calling
        webview2Impl_ = impl.get();
        impl_ = std::move(impl);
    }

    void Webview2Webview::LoadLocalFile(const std::string &path) {
        if (webview2Impl_->webviewWindow) {
            const auto pathUrl = "file:///" + path;
            std::wstring wpath = UTF8ToWString(pathUrl.c_str());
            webview2Impl_->webviewWindow->Navigate(wpath.c_str());
        } else {
            webview2Impl_->pathUrl.assign(path);
        }
    }

    void Webview2Webview::LoadRequest(const std::string &method,
                                      const std::string &urlString,
                                      const std::vector<HTTPHeader> &headers,
                                      const std::optional<std::string> &body) {
        std::wstring wURL = UTF8ToWString(urlString.c_str());
        webview2Impl_->webviewWindow->Navigate(wURL.c_str());
    }

    void Webview2Webview::Reload() { webview2Impl_->webviewWindow->Reload(); }

    void Webview2Webview::SetDevToolsEnabled(bool enabled) {
        if (enabled) {
            webview2Impl_->webviewWindow->OpenDevToolsWindow();
        } else {
        }
    }

    void Webview2Webview::ExecuteJavaScript(
        const std::string &scriptString,
        std::optional<JavaScriptExecutionCallback> &&cb) {
        std::wstring wScriptString = UTF8ToWString(scriptString.c_str());
        webview2Impl_->ExecuteJavaScript(wScriptString, std::move(cb));
    }

    Webview2Webview::~Webview2Webview() {}
} // namespace DeskGap
