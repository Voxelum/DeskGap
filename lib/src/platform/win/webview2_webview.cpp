
#include <cstdlib>
#include <atomic>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

#include <objbase.h>
#include <wil/com.h>
#include <wrl.h>

#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"

#include "unknwn.h"
#include "webview.hpp"
#include "webview_impl.h"

#include "webview2_webview.hpp"
#include "window_messages.h"

#include "./util/win32_check.h"
#include "./util/wstring_utf8.h"

extern "C" {
extern char BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT[];
extern int BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE;
}

namespace {
    const char* ProcessFailureReason(COREWEBVIEW2_PROCESS_FAILED_REASON reason) {
        switch (reason) {
        case COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE: return "unresponsive";
        case COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED: return "killed";
        case COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED: return "launch-failed";
        case COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY: return "oom";
        case COREWEBVIEW2_PROCESS_FAILED_REASON_PROFILE_DELETED: return "profile-deleted";
        case COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED: return "crashed";
        default: return "abnormal-exit";
        }
    }

    const char* ConsoleLevel(wchar_t code) {
        switch (code) {
        case L'd': return "debug";
        case L'w': return "warning";
        case L'e': return "error";
        default: return "info";
        }
    }
} // namespace

namespace DeskGap {
    std::string Webview2Webview::GetAvailableCoreVersion() {
        LPWSTR version = nullptr;
        if (SUCCEEDED(GetAvailableCoreWebView2BrowserVersionString(nullptr, &version))) {
            if (version == nullptr) {
                return "";
            }
            std::string result = WStringToUTF8(version);
            CoTaskMemFree(version);
            return result;
        }
        return "";
    }

    using namespace Microsoft::WRL;

    struct Webview2Webview::Impl : public WebView::Impl {
        wil::com_ptr<ICoreWebView2Controller> webviewController;
        wil::com_ptr<ICoreWebView2> webviewWindow;
        wil::com_ptr<ICoreWebView2Environment> webviewEnvironment;
        HWND containerWnd;
        WebView::EventCallbacks callbacks;
        std::wstring preloadScript;
        WebView::SessionOptions session;
        std::wstring userDataFolder;
        std::wstring browserArguments;
        std::string pathUrl = "";
        std::string requestUrl = "";
        std::string pendingNavigationUrl = "";
        std::optional<std::string> allowedNavigationUrl;
        bool allowedNavigationIsRedirect = false;
        uint64_t nextPolicyRequestId = 1;
        std::unordered_map<uint64_t, std::pair<std::string, bool>> pendingNavigationPolicies;
        std::unordered_set<uint64_t> policyCancelledNavigationIds;
        struct PendingProtocolRequest {
            wil::com_ptr<ICoreWebView2WebResourceRequestedEventArgs> args;
            wil::com_ptr<ICoreWebView2Deferral> deferral;
        };
        uint64_t nextProtocolRequestId = 1;
        std::unordered_map<uint64_t, PendingProtocolRequest> pendingProtocolRequests;
        std::string localFolder = "";
        std::string localHost = "";
        std::shared_ptr<std::atomic_bool> alive = std::make_shared<std::atomic_bool>(true);

        void NavigateToLocalFile() {
            if (!webviewWindow || pathUrl.empty()) return;
            wil::com_ptr<ICoreWebView2_3> webview3 = webviewWindow.query<ICoreWebView2_3>();
            const std::wstring host = UTF8ToWString(localHost.c_str());
            const std::wstring folder = UTF8ToWString(localFolder.c_str());
            check(webview3->SetVirtualHostNameToFolderMapping(
                host.c_str(), folder.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY
            ));
            const std::wstring url = UTF8ToWString(pathUrl.c_str());
            allowedNavigationUrl = pathUrl;
            allowedNavigationIsRedirect = false;
            webviewWindow->Navigate(url.c_str());
        }

        void NavigateToRequest() {
            if (!webviewWindow || requestUrl.empty()) return;
            const std::wstring url = UTF8ToWString(requestUrl.c_str());
            allowedNavigationUrl = requestUrl;
            allowedNavigationIsRedirect = false;
            webviewWindow->Navigate(url.c_str());
        }

        virtual void SetRect(int x, int y, int width, int height) override {
            RECT rect = {
                (long)x,
                (long)y,
                (long)x + width,
                (long)y + height,
            };
            if (webviewController) {
                check(webviewController->put_Bounds(rect));
            }
        }

        virtual void ParentWindowPositionChanged() override {
            if (webviewController) check(webviewController->NotifyParentWindowPositionChanged());
        }

        virtual void InitWithParent(HWND hWnd) override {
            containerWnd = hWnd;
            wil::com_ptr<CoreWebView2EnvironmentOptions> environmentOptions;
            if (session.proxyRules.has_value() || !session.customSchemes.empty()) {
                environmentOptions = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
            }
            if (session.proxyRules.has_value()) {
                if (*session.proxyRules == "direct://") {
                    browserArguments = L"--no-proxy-server";
                }
                else {
                    browserArguments = L"--proxy-server=\"" + UTF8ToWString(session.proxyRules->c_str()) + L"\"";
                }
                if (session.proxyBypassRules.has_value()) {
                    browserArguments += L" --proxy-bypass-list=\"" + UTF8ToWString(session.proxyBypassRules->c_str()) + L"\"";
                }
                environmentOptions->put_AdditionalBrowserArguments(browserArguments.c_str());
            }
            if (!session.customSchemes.empty()) {
                std::vector<ComPtr<ICoreWebView2CustomSchemeRegistration>> registrations;
                std::vector<ICoreWebView2CustomSchemeRegistration*> registrationPointers;
                registrations.reserve(session.customSchemes.size());
                registrationPointers.reserve(session.customSchemes.size());
                for (const auto& scheme : session.customSchemes) {
                    ComPtr<ICoreWebView2CustomSchemeRegistration> registration =
                        Microsoft::WRL::Make<CoreWebView2CustomSchemeRegistration>(
                            UTF8ToWString(scheme.name.c_str()).c_str()
                        );
                    registration->put_HasAuthorityComponent(TRUE);
                    registration->put_TreatAsSecure(FALSE);
                    LPCWSTR allowedOrigins[] = { L"*" };
                    registration->SetAllowedOrigins(1, allowedOrigins);
                    registrationPointers.push_back(registration.Get());
                    registrations.push_back(std::move(registration));
                }
                check(environmentOptions->SetCustomSchemeRegistrations(
                    static_cast<UINT32>(registrationPointers.size()), registrationPointers.data()
                ));
            }
            if (session.dataPath.has_value()) {
                userDataFolder = UTF8ToWString(session.dataPath->c_str());
            }
            CreateCoreWebView2EnvironmentWithOptions(
                nullptr,
                userDataFolder.empty() ? nullptr : userDataFolder.c_str(),
                environmentOptions.get(),
                Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([hWnd, this, alive = alive](HRESULT result,
                                                                                                                 ICoreWebView2Environment *env) -> HRESULT {
                    if (!alive->load()) return S_OK;
                    if (FAILED(result) || env == nullptr) {
                        callbacks.didFailLoad(
                            static_cast<int>(result),
                            "Failed to create the WebView2 environment",
                            pendingNavigationUrl
                        );
                        return S_OK;
                    }
                    this->webviewEnvironment = env;
                    // Create a CoreWebView2Controller and get the
                    // associated CoreWebView2 whose parent is the main
                    // window hWnd
                    env->CreateCoreWebView2Controller(
                        hWnd,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([hWnd,
                                                                                             this,
                                                                                             alive](HRESULT result,
                                                                                                    ICoreWebView2Controller *controller) -> HRESULT {
                            if (!alive->load()) return S_OK;
                            if (FAILED(result) || controller == nullptr) {
                                callbacks.didFailLoad(
                                    static_cast<int>(result),
                                    "Failed to create the WebView2 controller",
                                    pendingNavigationUrl
                                );
                                return S_OK;
                            }
                            if (controller != nullptr) {
                                this->webviewController = controller;
                                this->webviewController->get_CoreWebView2(&webviewWindow);
                            }
                            if (!webviewWindow) return S_OK;

                            // Add a few settings for the webview
                            // The demo step is redundant since the
                            // values are the default settings
                            wil::com_ptr<ICoreWebView2Settings> settings;
                            webviewWindow->get_Settings(settings.put());
                            settings->put_IsScriptEnabled(TRUE);
                            settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                            settings->put_IsWebMessageEnabled(TRUE);
                            if (session.userAgent.has_value()) {
                                wil::com_ptr<ICoreWebView2Settings2> settings2;
                                if (SUCCEEDED(settings->QueryInterface(IID_PPV_ARGS(&settings2)))) {
                                    const std::wstring userAgent = UTF8ToWString(session.userAgent->c_str());
                                    settings2->put_UserAgent(userAgent.c_str());
                                }
                            }

                            // Resize the WebView2 control to fit the
                            // bounds of the parent window
                            RECT bounds;
                            GetClientRect(hWnd, &bounds);
                            webviewController->put_Bounds(bounds);

                            EventRegistrationToken token;
                            webviewWindow->add_NavigationStarting(
                                Callback<ICoreWebView2NavigationStartingEventHandler>([this, alive](
                                    ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args
                                ) -> HRESULT {
                                    if (!alive->load()) return S_OK;
                                    wil::unique_cotaskmem_string uri;
                                    BOOL isRedirected = FALSE;
                                    args->get_IsRedirected(&isRedirected);
                                    if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                        this->pendingNavigationUrl = WStringToUTF8(uri.get());
                                        if (!isRedirected && allowedNavigationUrl.has_value()
                                            && *allowedNavigationUrl == pendingNavigationUrl) {
                                            allowedNavigationUrl.reset();
                                            this->callbacks.didStartNavigation(
                                                this->pendingNavigationUrl, allowedNavigationIsRedirect
                                            );
                                            allowedNavigationIsRedirect = false;
                                            return S_OK;
                                        }
                                        uint64_t navigationId = 0;
                                        args->get_NavigationId(&navigationId);
                                        args->put_Cancel(TRUE);
                                        policyCancelledNavigationIds.insert(navigationId);
                                        uint64_t requestId = nextPolicyRequestId++;
                                        pendingNavigationPolicies.emplace(
                                            requestId,
                                            std::make_pair(pendingNavigationUrl, isRedirected != FALSE)
                                        );
                                        callbacks.onNavigationPolicyRequest(requestId, pendingNavigationUrl, isRedirected);
                                    }
                                    return S_OK;
                                }).Get(),
                                &token
                            );
                            webviewWindow->add_NavigationCompleted(
                                          Callback<ICoreWebView2NavigationCompletedEventHandler>([this, alive](ICoreWebView2 *sender,
                                                                                                                                      ICoreWebView2NavigationCompletedEventArgs *args)
                                                                                                                                  -> HRESULT {
                                                if (!alive->load()) return S_OK;
                                    uint64_t navigationId = 0;
                                    args->get_NavigationId(&navigationId);
                                    if (policyCancelledNavigationIds.erase(navigationId) > 0) return S_OK;
                                    BOOL isSuccess = FALSE;
                                    args->get_IsSuccess(&isSuccess);
                                    if (isSuccess) {
                                        webviewController->put_IsVisible(true);
                                        this->callbacks.didFinishLoad();
                                    }
                                    else {
                                        COREWEBVIEW2_WEB_ERROR_STATUS status;
                                        args->get_WebErrorStatus(&status);
                                        this->callbacks.didFailLoad(
                                            -static_cast<int>(status),
                                            "WebView2 navigation error " + std::to_string(static_cast<int>(status)),
                                            this->pendingNavigationUrl
                                        );
                                    }
                                    return S_OK;
                                }).Get(),
                                &token);

                            webviewWindow->add_NewWindowRequested(
                                Callback<ICoreWebView2NewWindowRequestedEventHandler>([this, alive](
                                    ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args
                                ) -> HRESULT {
                                    if (!alive->load()) return S_OK;
                                    args->put_Handled(TRUE);
                                    wil::unique_cotaskmem_string uri;
                                    if (FAILED(args->get_Uri(&uri)) || !uri) return S_OK;
                                    std::string frameName;
                                    wil::com_ptr<ICoreWebView2NewWindowRequestedEventArgs2> args2;
                                    if (SUCCEEDED(args->QueryInterface(IID_PPV_ARGS(&args2)))) {
                                        wil::unique_cotaskmem_string name;
                                        if (SUCCEEDED(args2->get_Name(&name)) && name) {
                                            frameName = WStringToUTF8(name.get());
                                        }
                                    }
                                    callbacks.onNewWindowRequested(WStringToUTF8(uri.get()), frameName, "");
                                    return S_OK;
                                }).Get(),
                                &token
                            );

                            webviewWindow->add_ProcessFailed(
                                Callback<ICoreWebView2ProcessFailedEventHandler>([this, alive](
                                    ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args
                                ) -> HRESULT {
                                    if (!alive->load()) return S_OK;
                                    COREWEBVIEW2_PROCESS_FAILED_KIND kind;
                                    if (FAILED(args->get_ProcessFailedKind(&kind))) return S_OK;
                                    if (kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                                        && kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
                                        return S_OK;
                                    }
                                    COREWEBVIEW2_PROCESS_FAILED_REASON reason = COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED;
                                    int exitCode = -1;
                                    wil::com_ptr<ICoreWebView2ProcessFailedEventArgs2> args2;
                                    if (SUCCEEDED(args->QueryInterface(IID_PPV_ARGS(&args2)))) {
                                        args2->get_Reason(&reason);
                                        INT32 nativeExitCode = -1;
                                        if (SUCCEEDED(args2->get_ExitCode(&nativeExitCode))) exitCode = nativeExitCode;
                                    }
                                    callbacks.onRenderProcessGone(ProcessFailureReason(reason), exitCode);
                                    return S_OK;
                                }).Get(),
                                &token
                            );

                            if (!session.customSchemes.empty()) {
                                for (const auto& scheme : session.customSchemes) {
                                    const std::wstring filter = UTF8ToWString((scheme.name + "://*").c_str());
                                    check(webviewWindow->AddWebResourceRequestedFilter(
                                        filter.c_str(), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL
                                    ));
                                }
                                webviewWindow->add_WebResourceRequested(
                                    Callback<ICoreWebView2WebResourceRequestedEventHandler>([this, alive](
                                        ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args
                                    ) -> HRESULT {
                                        if (!alive->load()) return S_OK;
                                        wil::com_ptr<ICoreWebView2WebResourceRequest> request;
                                        if (FAILED(args->get_Request(&request)) || !request) return S_OK;
                                        wil::unique_cotaskmem_string uri;
                                        wil::unique_cotaskmem_string method;
                                        if (FAILED(request->get_Uri(&uri)) || !uri
                                            || FAILED(request->get_Method(&method)) || !method) return S_OK;

                                        std::vector<WebView::HTTPHeader> headers;
                                        wil::com_ptr<ICoreWebView2HttpRequestHeaders> requestHeaders;
                                        if (SUCCEEDED(request->get_Headers(&requestHeaders)) && requestHeaders) {
                                            wil::com_ptr<ICoreWebView2HttpHeadersCollectionIterator> iterator;
                                            if (SUCCEEDED(requestHeaders->GetIterator(&iterator)) && iterator) {
                                                BOOL hasCurrent = FALSE;
                                                iterator->get_HasCurrentHeader(&hasCurrent);
                                                while (hasCurrent) {
                                                    wil::unique_cotaskmem_string name;
                                                    wil::unique_cotaskmem_string value;
                                                    if (SUCCEEDED(iterator->GetCurrentHeader(&name, &value)) && name && value) {
                                                        headers.push_back({ WStringToUTF8(name.get()), WStringToUTF8(value.get()) });
                                                    }
                                                    iterator->MoveNext(&hasCurrent);
                                                }
                                            }
                                        }

                                        wil::com_ptr<ICoreWebView2Deferral> deferral;
                                        if (FAILED(args->GetDeferral(&deferral)) || !deferral) return S_OK;
                                        uint64_t requestId = nextProtocolRequestId++;
                                        pendingProtocolRequests.emplace(
                                            requestId, PendingProtocolRequest { args, deferral }
                                        );
                                        callbacks.onCustomProtocolRequest(
                                            requestId,
                                            WStringToUTF8(method.get()),
                                            WStringToUTF8(uri.get()),
                                            std::move(headers)
                                        );
                                        return S_OK;
                                    }).Get(),
                                    &token
                                );
                            }

                            wil::com_ptr<ICoreWebView2Controller2> controller2 = webviewController.query<ICoreWebView2Controller2>();
                            // COREWEBVIEW2_COLOR
                            COREWEBVIEW2_COLOR color{0, 0, 0, 0};
                            check(controller2->put_DefaultBackgroundColor(color));
                            // 4 - Navigation events

                            // 5 - Scripting

                            // 6 - Communication between host and web
                            webviewWindow->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>([this, alive](
                                                                                          ICoreWebView2 *webview,
                                                                                          ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                                    if (!alive->load()) return S_OK;
                                    wil::unique_cotaskmem_string message;
                                    if (SUCCEEDED(args->TryGetWebMessageAsString(&message)) &&
                                        wcscmp(message.get(), L"deskgap:files-dropped") == 0) {
                                        wil::com_ptr<ICoreWebView2WebMessageReceivedEventArgs2> args2;
                                        if (SUCCEEDED(args->QueryInterface(IID_PPV_ARGS(&args2)))) {
                                            wil::com_ptr<ICoreWebView2ObjectCollectionView> objects;
                                            check(args2->get_AdditionalObjects(&objects));

                                            UINT32 count = 0;
                                            check(objects->get_Count(&count));
                                            std::vector<std::string> paths;
                                            paths.reserve(count);
                                            for (UINT32 index = 0; index < count; ++index) {
                                                wil::com_ptr<IUnknown> object;
                                                check(objects->GetValueAtIndex(index, &object));
                                                wil::com_ptr<ICoreWebView2File> file;
                                                if (object && SUCCEEDED(object->QueryInterface(IID_PPV_ARGS(&file)))) {
                                                    wil::unique_cotaskmem_string path;
                                                    check(file->get_Path(&path));
                                                    paths.emplace_back(WStringToUTF8(path.get()));
                                                }
                                            }
                                            if (!paths.empty()) {
                                                callbacks.onFilesDropped(std::move(paths));
                                            }
                                        }
                                        return S_OK;
                                    }

                                    if (message && wcscmp(message.get(), L"deskgap:window-drag") == 0) {
                                        if (HWND windowWnd = GetAncestor(containerWnd, GA_ROOT); windowWnd != nullptr) {
                                            SetFocus(windowWnd);
                                            ::ReleaseCapture();
                                            SendMessage(windowWnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
                                        }
                                        return S_OK;
                                    }

                                    static const wchar_t resizePrefix[] = L"deskgap:window-resize:";
                                    if (message && wcsncmp(
                                        message.get(), resizePrefix, std::size(resizePrefix) - 1
                                    ) == 0) {
                                        const wchar_t* edge = message.get() + std::size(resizePrefix) - 1;
                                        WPARAM hitTest = wcscmp(edge, L"left") == 0 ? HTLEFT
                                            : wcscmp(edge, L"right") == 0 ? HTRIGHT
                                            : wcscmp(edge, L"top") == 0 ? HTTOP
                                            : wcscmp(edge, L"bottom") == 0 ? HTBOTTOM
                                            : wcscmp(edge, L"top-left") == 0 ? HTTOPLEFT
                                            : wcscmp(edge, L"top-right") == 0 ? HTTOPRIGHT
                                            : wcscmp(edge, L"bottom-left") == 0 ? HTBOTTOMLEFT
                                            : wcscmp(edge, L"bottom-right") == 0 ? HTBOTTOMRIGHT
                                            : HTNOWHERE;
                                        if (hitTest != HTNOWHERE) {
                                            if (HWND windowWnd = GetAncestor(containerWnd, GA_ROOT); windowWnd != nullptr) {
                                                SetFocus(windowWnd);
                                                ::ReleaseCapture();
                                                SendMessageW(windowWnd, WM_NCLBUTTONDOWN, hitTest, 0);
                                            }
                                        }
                                        return S_OK;
                                    }

                                    static const wchar_t windowControlPrefix[] = L"deskgap:window-control:";
                                    if (message && wcsncmp(
                                        message.get(), windowControlPrefix, std::size(windowControlPrefix) - 1
                                    ) == 0) {
                                        const wchar_t* action = message.get() + std::size(windowControlPrefix) - 1;
                                        WindowControlAction control = wcscmp(action, L"minimize") == 0
                                            ? WindowControlAction::Minimize
                                            : wcscmp(action, L"toggle-maximize") == 0
                                                ? WindowControlAction::ToggleMaximize
                                                : wcscmp(action, L"close") == 0
                                                    ? WindowControlAction::Close
                                                    : static_cast<WindowControlAction>(0);
                                        if (control != static_cast<WindowControlAction>(0)) {
                                            if (HWND windowWnd = GetAncestor(containerWnd, GA_ROOT); windowWnd != nullptr) {
                                                PostMessageW(
                                                    windowWnd,
                                                    WindowControlMessage,
                                                    static_cast<WPARAM>(control),
                                                    0
                                                );
                                            }
                                        }
                                        return S_OK;
                                    }

                                    static const wchar_t consolePrefix[] = L"deskgap:console:";
                                    if (message && wcsncmp(message.get(), consolePrefix, std::size(consolePrefix) - 1) == 0) {
                                        const wchar_t* payload = message.get() + std::size(consolePrefix) - 1;
                                        if (*payload != L'\0') {
                                            callbacks.onConsoleMessage(
                                                ConsoleLevel(*payload), WStringToUTF8(payload + 1)
                                            );
                                        }
                                        return S_OK;
                                    }

                                    return S_OK;
                                }).Get(),
                                &token);

                            webviewWindow->add_DocumentTitleChanged(
                                Callback<ICoreWebView2DocumentTitleChangedEventHandler>([this, alive](ICoreWebView2 *webview, IUnknown *args) {
                                    if (!alive->load()) return S_OK;
                                    wil::unique_cotaskmem_string title;
                                    webview->get_DocumentTitle(&title);
                                    this->callbacks.onPageTitleUpdated(WStringToUTF8(title.get()));
                                    return S_OK;
                                }).Get(),
                                &token);

                            webviewWindow->AddScriptToExecuteOnDocumentCreated(preloadScript.c_str(), nullptr);

                            if (pathUrl.length() > 0) {
                                NavigateToLocalFile();
                            }
                            else if (requestUrl.length() > 0) {
                                NavigateToRequest();
                            }

                            return S_OK;
                        }).Get());
                    return S_OK;
                }).Get());
        }

        Impl(WebView::EventCallbacks &callbacks, std::wstring &preload, WebView::SessionOptions&& session)
            : callbacks(std::move(callbacks)), containerWnd(nullptr), preloadScript(std::move(preload)), session(std::move(session)) {}

        void ExecuteJavaScript(const std::wstring &code, std::optional<JavaScriptExecutionCallback> &&cb) {
            webviewWindow->ExecuteScript(
                code.c_str(), Callback<ICoreWebView2ExecuteScriptCompletedHandler>([cb](HRESULT errorCode, LPCWSTR resultObjectAsJson) -> HRESULT {
                                  if (FAILED(errorCode)) {
                                      return errorCode;
                                  }
                                  if (cb.has_value()) {
                                      std::optional<std::string> resultMessage;
                                      resultMessage.emplace(WStringToUTF8(resultObjectAsJson));
                                      (*cb)(std::move(resultMessage));
                                  }
                                  return S_OK;
                              }).Get());
        }

        void ResolveNavigationPolicy(uint64_t requestId, bool allow) {
            auto request = pendingNavigationPolicies.find(requestId);
            if (request == pendingNavigationPolicies.end()) return;
            std::string url = std::move(request->second.first);
            bool isRedirect = request->second.second;
            pendingNavigationPolicies.erase(request);
            if (!allow || !webviewWindow) return;
            allowedNavigationUrl = url;
            allowedNavigationIsRedirect = isRedirect;
            const std::wstring wideUrl = UTF8ToWString(url.c_str());
            webviewWindow->Navigate(wideUrl.c_str());
        }

        void ResolveCustomProtocolRequest(
            uint64_t requestId,
            int statusCode,
            const std::string& statusText,
            const std::vector<WebView::HTTPHeader>& headers,
            std::vector<uint8_t>&& body
        ) {
            auto pending = pendingProtocolRequests.find(requestId);
            if (pending == pendingProtocolRequests.end()) return;
            PendingProtocolRequest request = std::move(pending->second);
            pendingProtocolRequests.erase(pending);

            std::wstring responseHeaders;
            for (const auto& header : headers) {
                responseHeaders += UTF8ToWString(header.field.c_str());
                responseHeaders += L": ";
                responseHeaders += UTF8ToWString(header.value.c_str());
                responseHeaders += L"\r\n";
            }
            wil::com_ptr<IStream> stream;
            if (!body.empty()) {
                check(CreateStreamOnHGlobal(nullptr, TRUE, &stream));
                ULONG written = 0;
                check(stream->Write(body.data(), static_cast<ULONG>(body.size()), &written));
                if (written != body.size()) throw std::runtime_error("Failed to write custom protocol response");
                LARGE_INTEGER start{};
                check(stream->Seek(start, STREAM_SEEK_SET, nullptr));
            }
            wil::com_ptr<ICoreWebView2WebResourceResponse> response;
            if (webviewEnvironment && SUCCEEDED(webviewEnvironment->CreateWebResourceResponse(
                stream.get(),
                statusCode,
                UTF8ToWString(statusText.c_str()).c_str(),
                responseHeaders.c_str(),
                &response
            ))) {
                request.args->put_Response(response.get());
            }
            request.deferral->Complete();
        }

        ~Impl() {
            alive->store(false);
            for (auto& [requestId, request] : pendingProtocolRequests) {
                callbacks.onCustomProtocolRequestCancelled(requestId);
                request.deferral->Complete();
            }
            pendingProtocolRequests.clear();
            webviewWindow.reset();
            webviewEnvironment.reset();
            webviewController.reset();
        }
    };

    Webview2Webview::Webview2Webview(
        EventCallbacks &&callbacks,
        const std::string &preloadScriptString,
        SessionOptions&& session
    ) {

        std::string script;
        script.reserve(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE + preloadScriptString.size());
        script.assign(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT, BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE);
        script.append(preloadScriptString);

        auto impl = std::make_unique<Impl>(callbacks, UTF8ToWString(script.c_str()), std::move(session));

        // impl_ for reference owning, and winrtImpl_ for method calling
        webview2Impl_ = impl.get();
        impl_ = std::move(impl);
    }

    void Webview2Webview::LoadLocalFile(const std::string &path, const std::string& fragment, const std::string& applicationHost) {
        const std::filesystem::path filePath(path);
        webview2Impl_->requestUrl.clear();
        webview2Impl_->localFolder = filePath.parent_path().string();
        webview2Impl_->localHost = applicationHost;
        webview2Impl_->pathUrl = "http://" + applicationHost + "/" + filePath.filename().string() + "#" + fragment;
        webview2Impl_->NavigateToLocalFile();
    }

    void Webview2Webview::LoadRequest(const std::string &method, const std::string &urlString, const std::vector<HTTPHeader> &headers,
                                      const std::optional<std::string> &body) {
        webview2Impl_->pathUrl.clear();
        webview2Impl_->requestUrl = urlString;
        webview2Impl_->NavigateToRequest();
    }

    void Webview2Webview::Reload() { webview2Impl_->webviewWindow->Reload(); }

    void Webview2Webview::ResolveNavigationPolicy(uint64_t requestId, bool allow) {
        webview2Impl_->ResolveNavigationPolicy(requestId, allow);
    }

    void Webview2Webview::ResolveCustomProtocolRequest(
        uint64_t requestId,
        int statusCode,
        const std::string& statusText,
        const std::vector<HTTPHeader>& headers,
        std::vector<uint8_t>&& body
    ) {
        webview2Impl_->ResolveCustomProtocolRequest(
            requestId, statusCode, statusText, headers, std::move(body)
        );
    }

    void Webview2Webview::SetDevToolsEnabled(bool enabled) {
        wil::com_ptr<ICoreWebView2Settings> settings;
        check(webview2Impl_->webviewWindow->get_Settings(&settings));
        check(settings->put_AreDevToolsEnabled(enabled ? TRUE : FALSE));
        if (enabled) {
            webview2Impl_->webviewWindow->OpenDevToolsWindow();
        }
    }

    void Webview2Webview::ExecuteJavaScript(const std::string &scriptString, std::optional<JavaScriptExecutionCallback> &&cb) {
        std::wstring wScriptString = UTF8ToWString(scriptString.c_str());
        webview2Impl_->ExecuteJavaScript(wScriptString, std::move(cb));
    }

    Webview2Webview::~Webview2Webview() {}
} // namespace DeskGap
