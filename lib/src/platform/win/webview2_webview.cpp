
#include <cstdlib>
#include <stdexcept>

#include <objbase.h>
#include <wil/com.h>
#include <wrl.h>

#include "WebView2.h"

#include "unknwn.h"
#include "webview.hpp"
#include "webview_impl.h"

#include "webview2_webview.hpp"

#include "./util/win32_check.h"
#include "./util/wstring_utf8.h"

extern "C" {
extern char BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT[];
extern int BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE;
}

namespace {
    interface IEventForwarder : IUnknown, IDispatch {};

    const DISPID kExternalDragDispid = 0x1001;
    const wchar_t *const kExternalDragName = L"drag";
} // namespace

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

    struct Webview2Webview::Impl : public WebView::Impl, public IEventForwarder {
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
            containerWnd = hWnd;
            CreateCoreWebView2EnvironmentWithOptions(
                nullptr, nullptr, nullptr,
                Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([hWnd, this](HRESULT result,
                                                                                                  ICoreWebView2Environment *env) -> HRESULT {
                    // Create a CoreWebView2Controller and get the
                    // associated CoreWebView2 whose parent is the main
                    // window hWnd
                    env->CreateCoreWebView2Controller(
                        hWnd,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([hWnd,
                                                                                             this](HRESULT result,
                                                                                                   ICoreWebView2Controller *controller) -> HRESULT {
                            if (controller != nullptr) {
                                this->webviewController = controller;
                                this->webviewController->get_CoreWebView2(&webviewWindow);
                            }

                            // Add a few settings for the webview
                            // The demo step is redundant since the
                            // values are the default settings
                            ICoreWebView2Settings *Settings;
                            webviewWindow->get_Settings(&Settings);
                            Settings->put_IsScriptEnabled(TRUE);
                            Settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                            Settings->put_IsWebMessageEnabled(TRUE);

                            // Resize the WebView2 control to fit the
                            // bounds of the parent window
                            RECT bounds;
                            GetClientRect(hWnd, &bounds);
                            webviewController->put_Bounds(bounds);

                            if (pathUrl.length() > 0) {
                                const auto pathUrl = "file:///" + this->pathUrl;
                                std::wstring wpath = UTF8ToWString(pathUrl.c_str());
                                webviewWindow->Navigate(wpath.c_str());
                            }

                            EventRegistrationToken token;
                            webviewWindow->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>([this](ICoreWebView2 *sender,
                                                                                              ICoreWebView2NavigationCompletedEventArgs *args)
                                                                                           -> HRESULT {
                                    // make visible
                                    webviewController->put_IsVisible(true);

                                    this->callbacks.didFinishLoad();
                                    return S_OK;
                                }).Get(),
                                &token);

                            wil::com_ptr<ICoreWebView2Controller2> controller2 = webviewController.query<ICoreWebView2Controller2>();
                            // COREWEBVIEW2_COLOR
                            COREWEBVIEW2_COLOR color{0, 0, 0, 0};
                            controller2->put_DefaultBackgroundColor(color);
                            // 4 - Navigation events

                            // 5 - Scripting

                            // 6 - Communication between host and web
                            webviewWindow->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>([this](
                                                                                          ICoreWebView2 *webview,
                                                                                          ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                                    PWSTR message;
                                    args->TryGetWebMessageAsString(&message);
                                    this->callbacks.onStringMessage(WStringToUTF8(message));
                                    CoTaskMemFree(message);
                                    return S_OK;
                                }).Get(),
                                &token);

                            VARIANT remoteObjectAsVariant = {};
                            remoteObjectAsVariant.pdispVal = static_cast<IDispatch *>(this);
                            remoteObjectAsVariant.vt = VT_DISPATCH;

                            check(webviewWindow->AddHostObjectToScript(L"eventForwarder", &remoteObjectAsVariant));

                            webviewWindow->add_DocumentTitleChanged(
                                Callback<ICoreWebView2DocumentTitleChangedEventHandler>([this](ICoreWebView2 *webview, IUnknown *args) {
                                    wil::unique_cotaskmem_string title;
                                    webview->get_DocumentTitle(&title);
                                    this->callbacks.onPageTitleUpdated(WStringToUTF8(title.get()));
                                    return S_OK;
                                }).Get(),
                                &token);

                            webviewWindow->AddScriptToExecuteOnDocumentCreated(preloadScript.c_str(), nullptr);

                            return S_OK;
                        }).Get());
                    return S_OK;
                }).Get());
        }

        Impl(WebView::EventCallbacks &callbacks, std::wstring &preload)
            : callbacks(std::move(callbacks)), containerWnd(nullptr), preloadScript(std::move(preload)) {}

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

        ~Impl() {}

        // IUnknown Begin
        STDMETHODIMP QueryInterface(REFIID riid, void **ppv) {
            HRESULT rc = S_OK;
            if (riid == IID_IUnknown) {
                *ppv = static_cast<IEventForwarder *>(this);
            } else if (riid == IID_IDispatch) {
                *ppv = static_cast<IDispatch *>(this);
            } else {
                return E_NOINTERFACE;
            }
            return rc;
        }

        ULONG STDMETHODCALLTYPE AddRef(void) override { return 1; }
        ULONG STDMETHODCALLTYPE Release(void) override { return 1; }
        // IUnknown End

        // IDispatch Begin
        HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT *) override { return S_OK; }
        HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT, LCID, ITypeInfo **) override { return S_OK; }
        HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID, LPOLESTR *rgszNames, UINT cNames, LCID lcid, DISPID *rgDispId) override {
            if (cNames == 0 || rgszNames == nullptr || rgszNames[0] == nullptr || rgDispId == nullptr) {
                return E_INVALIDARG;
            }
            if (wcscmp(rgszNames[0], kExternalDragName) == 0) {
                *rgDispId = kExternalDragDispid;
            }
            return S_OK;
        }

        HRESULT STDMETHODCALLTYPE Invoke(DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags, DISPPARAMS *pDispParams, VARIANT *pVarResult,
                                         EXCEPINFO *pExcepInfo, UINT *puArgErr) {
            if (dispIdMember == kExternalDragDispid) {
                if (HWND windowWnd = GetAncestor(containerWnd, GA_ROOT); windowWnd != nullptr) {
                    if (SetFocus(windowWnd) != nullptr) {
                        ::ReleaseCapture();
                        SendMessage(windowWnd, WM_NCLBUTTONDOWN, HTCAPTION, NULL);
                    }
                }
            }
            return S_OK;
        }
        // IDispatch End
    };

    Webview2Webview::Webview2Webview(EventCallbacks &&callbacks, const std::string &preloadScriptString) {

        std::string script;
        script.reserve(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE + preloadScriptString.size());
        script.assign(BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_CONTENT, BIN2CODE_DG_PRELOAD_WEBVIEW2_JS_SIZE);
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

    void Webview2Webview::LoadRequest(const std::string &method, const std::string &urlString, const std::vector<HTTPHeader> &headers,
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

    void Webview2Webview::ExecuteJavaScript(const std::string &scriptString, std::optional<JavaScriptExecutionCallback> &&cb) {
        std::wstring wScriptString = UTF8ToWString(scriptString.c_str());
        webview2Impl_->ExecuteJavaScript(wScriptString, std::move(cb));
    }

    Webview2Webview::~Webview2Webview() {}
} // namespace DeskGap
