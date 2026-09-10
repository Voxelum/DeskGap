#include <memory>
#include <vector>

#include "webview_wrap.h"
#include <deskgap/webview.hpp>
#include "../dispatch/dispatch.h"

extern "C" {
    extern char BIN2CODE_DG_UI_JS_CONTENT[];
    extern int BIN2CODE_DG_UI_JS_SIZE;
}


namespace DeskGap {
    namespace {
        std::optional<std::string> OptionalString(const Napi::Object& object, const char* key) {
            Napi::Value value = object.Get(key);
            return value.IsNull() || value.IsUndefined()
                ? std::nullopt
                : std::make_optional(value.As<Napi::String>().Utf8Value());
        }

        WebView::SessionOptions SessionOptionsFromJS(const Napi::Object& object) {
            Napi::Array jsSchemes = object.Get("customSchemes").As<Napi::Array>();
            std::vector<WebView::CustomScheme> customSchemes;
            customSchemes.reserve(jsSchemes.Length());
            for (uint32_t index = 0; index < jsSchemes.Length(); ++index) {
                Napi::Object jsScheme = jsSchemes.Get(index).As<Napi::Object>();
                customSchemes.push_back({
                    jsScheme.Get("scheme").As<Napi::String>().Utf8Value(),
                });
            }
            return {
                object.Get("id").As<Napi::String>().Utf8Value(),
                object.Get("kind").As<Napi::String>().Utf8Value(),
                OptionalString(object, "name"),
                OptionalString(object, "dataPath"),
                OptionalString(object, "userAgent"),
                OptionalString(object, "proxyRules"),
                OptionalString(object, "proxyBypassRules"),
                std::move(customSchemes),
            };
        }
    }

    Napi::Function WebViewWrap::Constructor(const Napi::Env& env) {
        return DefineClass(env, "WebViewNative", {
        #ifdef WIN32
            StaticMethod("isWinRTEngineAvailable", &WebViewWrap::IsWinRTEngineAvailable),
            StaticMethod("getWebview2Version", &WebViewWrap::GetWebview2Version),
        #endif
            InstanceMethod("loadLocalFile", &WebViewWrap::LoadLocalFile),
            InstanceMethod("getLocalFileOrigin", &WebViewWrap::GetLocalFileOrigin),
            InstanceMethod("loadRequest", &WebViewWrap::LoadRequest),
            InstanceMethod("executeJavaScript", &WebViewWrap::ExecuteJavaScript),
            InstanceMethod("reload", &WebViewWrap::Reload),
            InstanceMethod("resolveNavigationPolicy", &WebViewWrap::ResolveNavigationPolicy),
            InstanceMethod("resolveCustomProtocolRequest", &WebViewWrap::ResolveCustomProtocolRequest),
            InstanceMethod("setDevToolsEnabled", &WebViewWrap::SetDevToolsEnabled),
            InstanceMethod("trySuspend", &WebViewWrap::TrySuspend),
            InstanceMethod("resume", &WebViewWrap::Resume),
            InstanceMethod("destroy", &WebViewWrap::Destroy),
        });
    }

    WebViewWrap::WebViewWrap(const Napi::CallbackInfo& info):
            Napi::ObjectWrap<WebViewWrap>(info)
    {
        Napi::Object jsCallbacks = info[0].As<Napi::Object>();
        WebView::SessionOptions sessionOptions = SessionOptionsFromJS(info[2].As<Napi::Object>());
        std::optional<uint32_t> backgroundColor = info[3].IsNumber()
            ? std::make_optional(info[3].As<Napi::Number>().Uint32Value())
            : std::nullopt;

        WebView::EventCallbacks eventCallbacks {
            [jsDidFinishLoad = JSFunctionForUI::Persist(jsCallbacks.Get("didFinishLoad").As<Napi::Function>())]() {
                jsDidFinishLoad->Call();
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("didStartNavigation").As<Napi::Function>())](const std::string& url, bool isRedirect) {
                callback->Call([url, isRedirect](auto env) -> std::vector<napi_value> {
                    return { Napi::String::New(env, url), Napi::Boolean::New(env, isRedirect) };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("didFailLoad").As<Napi::Function>())](int errorCode, const std::string& description, const std::string& url) {
                callback->Call([errorCode, description, url](auto env) -> std::vector<napi_value> {
                    return {
                        Napi::Number::New(env, errorCode),
                        Napi::String::New(env, description),
                        Napi::String::New(env, url),
                    };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onNavigationPolicyRequest").As<Napi::Function>())](uint64_t requestId, const std::string& url, bool isRedirect) {
                callback->Call([requestId, url, isRedirect](auto env) -> std::vector<napi_value> {
                    return {
                        Napi::Number::New(env, static_cast<double>(requestId)),
                        Napi::String::New(env, url),
                        Napi::Boolean::New(env, isRedirect),
                    };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onNewWindowRequested").As<Napi::Function>())](const std::string& url, const std::string& frameName, const std::string& features) {
                callback->Call([url, frameName, features](auto env) -> std::vector<napi_value> {
                    return {
                        Napi::String::New(env, url),
                        Napi::String::New(env, frameName),
                        Napi::String::New(env, features),
                    };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onRenderProcessGone").As<Napi::Function>())](const std::string& reason, int exitCode) {
                callback->Call([reason, exitCode](auto env) -> std::vector<napi_value> {
                    return {
                        Napi::String::New(env, reason),
                        Napi::Number::New(env, exitCode),
                    };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onConsoleMessage").As<Napi::Function>())](const std::string& level, const std::string& message) {
                callback->Call([level, message](auto env) -> std::vector<napi_value> {
                    return {
                        Napi::String::New(env, level),
                        Napi::String::New(env, message),
                    };
                });
            },
            [jsOnPageTitleUpdated = JSFunctionForUI::Persist(jsCallbacks.Get("onPageTitleUpdated").As<Napi::Function>())](const std::string& title) {
                jsOnPageTitleUpdated->Call([title](auto env) -> std::vector<napi_value> {
                    return { Napi::String::New(env, title) };
                });
            },
            [jsOnFilesDropped = JSFunctionForUI::Persist(jsCallbacks.Get("onFilesDropped").As<Napi::Function>())](std::vector<std::string>&& paths) {
                jsOnFilesDropped->Call([paths { std::move(paths) }](auto env) -> std::vector<napi_value> {
                    Napi::Array jsPaths = Napi::Array::New(env, paths.size());
                    for (size_t index = 0; index < paths.size(); ++index) {
                        jsPaths.Set(index, Napi::String::New(env, paths[index]));
                    }
                    return { jsPaths };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onCustomProtocolRequest").As<Napi::Function>())](
                uint64_t requestId,
                const std::string& method,
                const std::string& url,
                std::vector<WebView::HTTPHeader>&& headers
            ) {
                callback->Call([requestId, method, url, headers = std::move(headers)](auto env) -> std::vector<napi_value> {
                    Napi::Array jsHeaders = Napi::Array::New(env, headers.size());
                    for (size_t index = 0; index < headers.size(); ++index) {
                        Napi::Array jsHeader = Napi::Array::New(env, 2);
                        jsHeader.Set((uint32_t)0, Napi::String::New(env, headers[index].field));
                        jsHeader.Set((uint32_t)1, Napi::String::New(env, headers[index].value));
                        jsHeaders.Set(index, jsHeader);
                    }
                    return {
                        Napi::Number::New(env, static_cast<double>(requestId)),
                        Napi::String::New(env, method),
                        Napi::String::New(env, url),
                        jsHeaders,
                    };
                });
            },
            [callback = JSFunctionForUI::Persist(jsCallbacks.Get("onCustomProtocolRequestCancelled").As<Napi::Function>())](uint64_t requestId) {
                callback->Call([requestId](auto env) -> std::vector<napi_value> {
                    return { Napi::Number::New(env, static_cast<double>(requestId)) };
                });
            },
        };

    #ifdef WIN32
        Napi::Number engineValue = info[1].As<Napi::Number>();
        Engine engine = static_cast<Engine>(engineValue.Uint32Value());
        if (engine != Engine::WINRT && engine != Engine::WEBVIEW2) {
            Napi::TypeError::New(info.Env(), "Unsupported webview engine").ThrowAsJavaScriptException();
            return;
        }
    #endif

        UISyncDelayable(info.Env(), [
            this,
            eventCallbacks = std::move(eventCallbacks),
            sessionOptions = std::move(sessionOptions),
            backgroundColor
        #ifdef WIN32
            , engine
        #endif
        ]() mutable {
            static std::string dgPreloadScript(BIN2CODE_DG_UI_JS_CONTENT, BIN2CODE_DG_UI_JS_SIZE);
        #ifdef WIN32
            if (engine == Engine::WEBVIEW2) {
                this->webview_ = std::make_unique<Webview2Webview>(
                    std::move(eventCallbacks),
                    dgPreloadScript,
                    std::move(sessionOptions),
                    backgroundColor
                );
            }
            else {
                this->webview_ = std::make_unique<WinRTWebView>(std::move(eventCallbacks), dgPreloadScript, std::move(sessionOptions));
            }
        #else
            this->webview_ = std::make_unique<WebView>(std::move(eventCallbacks), dgPreloadScript, std::move(sessionOptions));
        #endif

        });
    }
    
    #ifdef WIN32
    Napi::Value WebViewWrap::IsWinRTEngineAvailable(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), WebView::IsWinRTWebViewAvailable());
    }
    Napi::Value WebViewWrap::GetWebview2Version(const Napi::CallbackInfo& info) {
        std::string version(WebView::GetWebview2Version());
        return Napi::String::New(info.Env(), version);
    }
    #endif

    Napi::Value WebViewWrap::GetLocalFileOrigin(const Napi::CallbackInfo& info) {
        std::string origin;
        UISync(info.Env(), [this, &origin]() { origin = this->webview_->GetLocalFileOrigin(); });
        return Napi::String::New(info.Env(), origin);
    }

    void WebViewWrap::LoadLocalFile(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [
            this,
            path = info[0].As<Napi::String>().Utf8Value(),
            fragment = info[1].As<Napi::String>().Utf8Value(),
            applicationHost = info[2].As<Napi::String>().Utf8Value()
        ]() {
            this->webview_->LoadLocalFile(path, fragment, applicationHost);
        });
    }

    void WebViewWrap::LoadRequest(const Napi::CallbackInfo& info) {
        std::string method = info[0].As<Napi::String>().Utf8Value();
        std::string url = info[1].As<Napi::String>().Utf8Value();
        Napi::Array jsHeaders = info[2].As<Napi::Array>();
        std::vector<WebView::HTTPHeader> headers;

        uint32_t headerCount = jsHeaders.Length();
        headers.reserve(headerCount);

        for (uint32_t i = 0; i < headerCount; ++i) {
            Napi::Array jsHeader = jsHeaders.Get(i).As<Napi::Array>();
            headers.push_back({
                jsHeader.Get((uint32_t)0).As<Napi::String>().Utf8Value(),
                jsHeader.Get((uint32_t)1).As<Napi::String>().Utf8Value()
            });
        }

        std::optional<std::string> body;
        Napi::Value jsBody = info[3];
        if (!jsBody.IsNull() && !jsBody.IsUndefined()) {
            body = jsBody.As<Napi::String>().Utf8Value();
        }

        UISyncDelayable(info.Env(), [
            this, method, url, headers, body
        ] {
            this->webview_->LoadRequest(method, url, headers, body);
        });
    }

    void WebViewWrap::ResolveNavigationPolicy(const Napi::CallbackInfo& info) {
        uint64_t requestId = static_cast<uint64_t>(info[0].As<Napi::Number>().Int64Value());
        bool allow = info[1].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, requestId, allow] {
            this->webview_->ResolveNavigationPolicy(requestId, allow);
        });
    }

    void WebViewWrap::ResolveCustomProtocolRequest(const Napi::CallbackInfo& info) {
        uint64_t requestId = static_cast<uint64_t>(info[0].As<Napi::Number>().Int64Value());
        int statusCode = info[1].As<Napi::Number>().Int32Value();
        std::string statusText = info[2].As<Napi::String>().Utf8Value();
        Napi::Array jsHeaders = info[3].As<Napi::Array>();
        std::vector<WebView::HTTPHeader> headers;
        headers.reserve(jsHeaders.Length());
        for (uint32_t index = 0; index < jsHeaders.Length(); ++index) {
            Napi::Array jsHeader = jsHeaders.Get(index).As<Napi::Array>();
            headers.push_back({
                jsHeader.Get((uint32_t)0).As<Napi::String>().Utf8Value(),
                jsHeader.Get((uint32_t)1).As<Napi::String>().Utf8Value(),
            });
        }
        Napi::Buffer<uint8_t> jsBody = info[4].As<Napi::Buffer<uint8_t>>();
        std::vector<uint8_t> body(jsBody.Data(), jsBody.Data() + jsBody.Length());
        UISyncDelayable(info.Env(), [
            this, requestId, statusCode, statusText, headers = std::move(headers), body = std::move(body)
        ]() mutable {
            this->webview_->ResolveCustomProtocolRequest(
                requestId, statusCode, statusText, headers, std::move(body)
            );
        });
    }
    void WebViewWrap::Reload(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this]() {
            this->webview_->Reload();
        });
    }

    void WebViewWrap::SetDevToolsEnabled(const Napi::CallbackInfo& info) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        UISyncDelayable(info.Env(), [this, enabled]() {
            this->webview_->SetDevToolsEnabled(enabled);
        });
    }

    void WebViewWrap::TrySuspend(const Napi::CallbackInfo& info) {
        auto callback = JSFunctionForUI::Persist(info[0].As<Napi::Function>());
        UISyncDelayable(info.Env(), [this, callback]() {
            this->webview_->TrySuspend([callback](bool suspended) {
                callback->Call([suspended](auto env) -> std::vector<napi_value> {
                    return { Napi::Boolean::New(env, suspended) };
                });
            });
        });
    }

    void WebViewWrap::Resume(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this]() {
            this->webview_->Resume();
        });
    }

    void WebViewWrap::ExecuteJavaScript(const Napi::CallbackInfo& info) {
        std::optional<WebView::JavaScriptExecutionCallback> optionalCallback;
        if (Napi::Value secondArg = info[1]; !secondArg.IsNull()) {
            optionalCallback.emplace([
                jsCallback { JSFunctionForUI::Persist(secondArg.As<Napi::Function>()) }
            ](std::optional<std::string>&& errorMessage) {
                jsCallback->Call([errorMessage { std::move(errorMessage) }](auto env) -> std::vector<napi_value>  {
                    if (errorMessage.has_value()) {
                        return { Napi::String::New(env, *errorMessage) };
                    }
                    else {
                        return { Napi::Env(env).Null() };
                    }
                });
            });
        }
        UISyncDelayable(info.Env(), [
            this,
            script { info[0].As<Napi::String>().Utf8Value() },
            optionalCallback { std::move(optionalCallback) }
        ]() mutable {
            this->webview_->ExecuteJavaScript(script, std::move(optionalCallback));
        });
    }

    void WebViewWrap::Destroy(const Napi::CallbackInfo& info) {
        UISyncDelayable(info.Env(), [this]() {
            this->webview_.reset();
        });
    }
}
