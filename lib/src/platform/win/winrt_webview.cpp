#include <functional>
#include <memory>
#include <string>
#include <optional>
#include <unordered_map>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <cassert>
#include <cctype>

#include <Windows.h>
#include <objbase.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Web.UI.Interop.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Web.Http.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Foundation.Metadata.h>

#include "winrt_webview.hpp"
#include "webview_impl.h"
#include "exception.hpp"

#pragma comment(lib, "WindowsApp")


extern "C" {
    extern char BIN2CODE_DG_PRELOAD_WINRT_JS_CONTENT[];
    extern int BIN2CODE_DG_PRELOAD_WINRT_JS_SIZE;
}

namespace fs = std::filesystem;

using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Web;
using namespace winrt::Windows::Web::UI;
using namespace winrt::Windows::Web::UI::Interop;
using namespace winrt::Windows::Storage;

namespace {
    const wchar_t* const WebViewHostWndClassName = L"DeskGapWinRTWebViewHost";
    const winrt::hstring LocalContentIdentifier = L"DeskGapLocalContent";

    const wchar_t WindowDragNotifyStringPrefix = L'd';
    const wchar_t TitleUpdatedNotifyStringPrefix = L't';
    const wchar_t ConsoleNotifyStringPrefix = L'c';

    std::unique_ptr<winrt::hstring> preloadScript;
}

namespace DeskGap {
    namespace {
        class StreamResolver : public winrt::implements<StreamResolver, IUriToStreamResolver> {
        private:
            std::optional<fs::path> folder_;
        public:
            void setFolder(std::optional<fs::path>&& folder) {
                folder_ = std::move(folder);
            }
            IAsyncOperation<Streams::IInputStream> UriToStreamAsync(Uri uri) {
                if (!folder_.has_value()) return nullptr;
                const wchar_t* wpath = uri.Path().c_str();
                while (*wpath == '/') ++wpath;

                std::string fullPath = (folder_.value() / winrt::to_string(wpath)).string();

                StorageFile file = co_await StorageFile::GetFileFromPathAsync(winrt::to_hstring(fullPath));
                Streams::IInputStream stream = co_await file.OpenReadAsync();
                co_return stream;
            }
        };
    }
    bool WinRTWebView::IsAvailable() {
        // WinRTWebView needs WebViewControl#AddInitializeScript, which is a method of IWebViewControl2, which is in UniversalApiContract 7.
        return winrt::Windows::Foundation::Metadata::ApiInformation::IsApiContractPresent(L"Windows.Foundation.UniversalApiContract", 7);
    }

    struct WinRTWebView::Impl: public WebView::Impl {
        HWND controlWnd;
        winrt::Windows::Web::UI::Interop::WebViewControlProcess process;
        winrt::Windows::Web::UI::Interop::WebViewControl webViewControl;

        winrt::Windows::Web::UI::Interop::WebViewControl::NavigationCompleted_revoker navigationCompletedRevoker;
        winrt::Windows::Web::UI::Interop::WebViewControl::NavigationStarting_revoker navigationStartingRevoker;
        winrt::Windows::Web::UI::Interop::WebViewControl::NewWindowRequested_revoker newWindowRequestedRevoker;
        winrt::Windows::Web::UI::Interop::WebViewControl::ScriptNotify_revoker scriptNotifyRevoker;

        StreamResolver streamResolver;

        WebView::EventCallbacks callbacks;
        std::optional<std::string> allowedNavigationUrl;
        uint64_t nextPolicyRequestId = 1;
        unsigned int policyCancelledCompletions = 0;
        std::unordered_map<uint64_t, std::string> pendingNavigationPolicies;

        Impl(WebView::EventCallbacks& callbacks):
            callbacks(std::move(callbacks)),
            process(nullptr), webViewControl(nullptr) {

        }

        ~Impl() {
            navigationCompletedRevoker.revoke();
            navigationStartingRevoker.revoke();
            newWindowRequestedRevoker.revoke();
            scriptNotifyRevoker.revoke();
            if (webViewControl != nullptr) {
                webViewControl.Close();
                webViewControl = nullptr;
            }
            if (process != nullptr) {
                process = nullptr;
            }
        }

        void PrepareScript() {
            webViewControl.AddInitializeScript(*preloadScript);
        }

        virtual void SetRect(int x, int y, int width, int height) override {
            if (webViewControl == nullptr) return;
            webViewControl.Bounds(Rect(
                0, 0,
                width,
                height
            ));
        }

        virtual void ParentWindowPositionChanged() override { }

        virtual void InitWithParent(HWND parentWnd) override {
            controlWnd = parentWnd;

            IAsyncOperation<WebViewControl> asyncOperation = process.CreateWebViewControlAsync(
                reinterpret_cast<int64_t>(controlWnd),
                { }
            );

            HANDLE actionCompleted = CreateEventExW(nullptr, nullptr, 0, SYNCHRONIZE | EVENT_MODIFY_STATE);
            DWORD handleIndex = 0;

            asyncOperation.Completed([&](const auto&, const auto&) {
                SetEvent(actionCompleted);
            });

            CoWaitForMultipleHandles(0, INFINITE, 1, &actionCompleted, &handleIndex);
            CloseHandle(actionCompleted);

            if (asyncOperation.Status() != AsyncStatus::Completed) {
                winrt::hresult_error hrError(asyncOperation.ErrorCode());
                throw DeskGap::Exception { "HRESULT: " + std::to_string(hrError.code()), winrt::to_string(hrError.message()) };
            }

            webViewControl = asyncOperation.GetResults();
            webViewControl.Settings().IsScriptNotifyAllowed(true);

            // winrt::Windows::ApplicationModel::AppInfo::GetFromAppUserModelId()

            navigationCompletedRevoker = webViewControl.NavigationCompleted(
                winrt::auto_revoke, 
                [this](const auto&, const WebViewControlNavigationCompletedEventArgs& e) {
                    if (!e.IsSuccess() && policyCancelledCompletions > 0) {
                        --policyCancelledCompletions;
                        return;
                    }
                    if (e.IsSuccess()) {
                        this->callbacks.didFinishLoad();
                    }
                    else {
                        this->callbacks.didFailLoad(
                            -static_cast<int>(e.WebErrorStatus()),
                            "WinRT navigation error " + std::to_string(static_cast<int>(e.WebErrorStatus())),
                            winrt::to_string(e.Uri().AbsoluteUri())
                        );
                    }
                }
            );

            navigationStartingRevoker = webViewControl.NavigationStarting(
                winrt::auto_revoke,
                [this](const auto&, const WebViewControlNavigationStartingEventArgs& e) {
                    std::string url = winrt::to_string(e.Uri().AbsoluteUri());
                    if (allowedNavigationUrl.has_value() && *allowedNavigationUrl == url) {
                        allowedNavigationUrl.reset();
                        this->callbacks.didStartNavigation(url, false);
                        return;
                    }
                    e.Cancel(true);
                    ++policyCancelledCompletions;
                    uint64_t requestId = nextPolicyRequestId++;
                    pendingNavigationPolicies.emplace(requestId, url);
                    callbacks.onNavigationPolicyRequest(requestId, url, false);
                }
            );

            newWindowRequestedRevoker = webViewControl.NewWindowRequested(
                winrt::auto_revoke,
                [this](const auto&, const WebViewControlNewWindowRequestedEventArgs& e) {
                    e.Handled(true);
                    callbacks.onNewWindowRequested(winrt::to_string(e.Uri().AbsoluteUri()), "", "");
                }
            );


            scriptNotifyRevoker = webViewControl.ScriptNotify(
                winrt::auto_revoke,
                [this](const auto&, const WebViewControlScriptNotifyEventArgs& e) {
                    winrt::hstring notifyString = e.Value();
                    if (notifyString.empty()) return;
                    wchar_t notifyStringPrefix = notifyString[0];
                    std::string notifyContent = winrt::to_string(notifyString.c_str() + 1);
                    switch (notifyStringPrefix) {
                    case WindowDragNotifyStringPrefix: {
                        if (HWND windowWnd = GetAncestor(controlWnd, GA_ROOT); windowWnd != nullptr) {
                            if (SetFocus(windowWnd) != nullptr) {
                                SendMessage(windowWnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
                            }
                        }
                        break;
                    }
                    case TitleUpdatedNotifyStringPrefix: {
                        callbacks.onPageTitleUpdated(std::move(notifyContent));
                        break;
                    }
                    case ConsoleNotifyStringPrefix: {
                        if (!notifyContent.empty()) {
                            const char* level = notifyContent[0] == 'd' ? "debug"
                                : notifyContent[0] == 'w' ? "warning"
                                : notifyContent[0] == 'e' ? "error" : "info";
                            callbacks.onConsoleMessage(level, notifyContent.substr(1));
                        }
                        break;
                    }
                    default:
                        break;
                    }
                }
            );
        }; 

        void ResolveNavigationPolicy(uint64_t requestId, bool allow) {
            auto request = pendingNavigationPolicies.find(requestId);
            if (request == pendingNavigationPolicies.end()) return;
            std::string url = std::move(request->second);
            pendingNavigationPolicies.erase(request);
            if (!allow || webViewControl == nullptr) return;
            allowedNavigationUrl = url;
            webViewControl.Navigate(Uri(winrt::to_hstring(url)));
        }
    };

    WinRTWebView::WinRTWebView(
        EventCallbacks&& callbacks,
        const std::string& preloadScriptString,
        SessionOptions&&
    ) {
        std::string script;
        script.reserve(BIN2CODE_DG_PRELOAD_WINRT_JS_SIZE + preloadScriptString.size());
        script.assign(BIN2CODE_DG_PRELOAD_WINRT_JS_CONTENT, BIN2CODE_DG_PRELOAD_WINRT_JS_SIZE);
        script.append(preloadScriptString);
        preloadScript = std::make_unique<winrt::hstring>(winrt::to_hstring(script));

        auto winrtImpl = std::make_unique<Impl>(callbacks);

        //impl_ for reference owning, and winrtImpl_ for method calling
        winrtImpl_ = winrtImpl.get();
        impl_ = std::move(winrtImpl);

        WebViewControlProcessOptions options;
        options.PrivateNetworkClientServerCapability(WebViewControlProcessCapabilityState::Enabled);
        winrtImpl_->process = WebViewControlProcess(options);
        //The real creation of WebViewControl happens in WinRTWebView::Impl::InitWithParent,
        //which is called by BrowserWindow, because it needs the handle of the window.
    }


    void WinRTWebView::LoadLocalFile(const std::string& path, const std::string& fragment, const std::string&) {
        winrtImpl_->PrepareScript();
        fs::path fsPath(path);
        winrtImpl_->streamResolver.setFolder(fsPath.parent_path());

        Uri uri = winrtImpl_->webViewControl.BuildLocalStreamUri(LocalContentIdentifier, winrt::to_hstring(fsPath.filename().string()));
        std::wstring uriWithFragment(uri.AbsoluteUri());
        uriWithFragment.append(L"#");
        uriWithFragment.append(winrt::to_hstring(fragment));
        winrtImpl_->allowedNavigationUrl = winrt::to_string(uriWithFragment);
        winrtImpl_->webViewControl.NavigateToLocalStreamUri(Uri(uriWithFragment), winrtImpl_->streamResolver);
    }

    void WinRTWebView::LoadRequest(
        const std::string& method,
        const std::string& urlString,
        const std::vector<HTTPHeader>& headers,
        const std::optional<std::string>& body
    ) {
        winrtImpl_->PrepareScript();
        winrtImpl_->streamResolver.setFolder(std::nullopt);

        Http::HttpRequestMessage httpMessage(
            Http::HttpMethod(winrt::to_hstring(method)),
            Uri(winrt::to_hstring(urlString))
        );
        if (body.has_value()) {
            httpMessage.Content(Http::HttpStringContent(winrt::to_hstring(*body)));
        }
        for (const HTTPHeader& header: headers) {
            static const std::string contentTypeField = "content-type";
            if (std::equal(
                header.field.begin(), header.field.end(),
                contentTypeField.begin(), contentTypeField.end(),
                [](char a, char b) { return std::tolower(a) == b;}
            )) {
                httpMessage.Content().Headers().ContentType(
                    Http::Headers::HttpMediaTypeHeaderValue(winrt::to_hstring(header.value))
                );
            }
            else {
                httpMessage.Headers().Append(
                    winrt::to_hstring(header.field),
                    winrt::to_hstring(header.value)
                );
            }
        }
        winrtImpl_->allowedNavigationUrl = urlString;
        winrtImpl_->webViewControl.NavigateWithHttpRequestMessage(httpMessage);
    }

    void WinRTWebView::ExecuteJavaScript(const std::string& scriptString, std::optional<JavaScriptExecutionCallback>&& optionalCallback) {
        std::vector<winrt::hstring> arguments { winrt::to_hstring(scriptString) };
        IAsyncOperation<winrt::hstring> operation = winrtImpl_->webViewControl.InvokeScriptAsync(
            L"eval", std::move(arguments)
        );
        if (!optionalCallback.has_value()) return;

        operation.Completed([
            callback = std::move(*optionalCallback)
        ](const auto& completedOperation, AsyncStatus status) mutable {
            if (status == AsyncStatus::Completed) {
                callback(std::nullopt);
                return;
            }
            winrt::hresult_error error(completedOperation.ErrorCode());
            callback(std::make_optional<std::string>(
                "HRESULT " + std::to_string(error.code()) + ": " + winrt::to_string(error.message())
            ));
        });
    }

    void WinRTWebView::SetDevToolsEnabled(bool enabled) { 

    }

    void WinRTWebView::Reload() {
        winrtImpl_->PrepareScript();
        winrtImpl_->webViewControl.Refresh();
    }

    void WinRTWebView::ResolveNavigationPolicy(uint64_t requestId, bool allow) {
        winrtImpl_->ResolveNavigationPolicy(requestId, allow);
    }

    void WinRTWebView::ResolveCustomProtocolRequest(
        uint64_t,
        int,
        const std::string&,
        const std::vector<HTTPHeader>&,
        std::vector<uint8_t>&&
    ) {}

    WinRTWebView::~WinRTWebView() {}
}
