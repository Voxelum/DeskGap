#include "notification_wrap.h"

#include "../dispatch/dispatch.h"

namespace DeskGap {
    NotificationWrap::NotificationWrap(const Napi::CallbackInfo& info): Napi::ObjectWrap<NotificationWrap>(info) {
        Napi::Object options = info[0].As<Napi::Object>();
        Napi::Object callbacks = info[1].As<Napi::Object>();
        auto icon = options.Get("iconPng").As<Napi::Buffer<uint8_t>>();
        Notification::Options nativeOptions {
            options.Get("title").As<Napi::String>().Utf8Value(),
            options.Get("body").As<Napi::String>().Utf8Value(),
            std::vector<uint8_t>(icon.Data(), icon.Data() + icon.Length()),
            options.Get("silent").As<Napi::Boolean>().Value(),
        };
        Notification::EventCallbacks nativeCallbacks {
            [callback = JSFunctionForUI::Persist(callbacks.Get("onShow").As<Napi::Function>(), true)]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(callbacks.Get("onClick").As<Napi::Function>(), true)]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(callbacks.Get("onClose").As<Napi::Function>(), true)]() { callback->Call(); },
            [callback = JSFunctionForUI::Persist(callbacks.Get("onFailed").As<Napi::Function>(), true)](const std::string& error) {
                callback->Call([error](auto env) -> std::vector<napi_value> {
                    return { Napi::String::New(env, error) };
                });
            },
        };
        UISync(info.Env(), [this, options = std::move(nativeOptions), callbacks = std::move(nativeCallbacks)]() mutable {
            notification_ = std::make_unique<Notification>(std::move(options), std::move(callbacks));
        });
    }

    void NotificationWrap::Show(const Napi::CallbackInfo& info) {
        UISync(info.Env(), [this] { notification_->Show(); });
    }

    void NotificationWrap::Close(const Napi::CallbackInfo& info) {
        UISync(info.Env(), [this] { notification_->Close(); });
    }

    Napi::Value NotificationWrap::IsSupported(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), Notification::IsSupported());
    }

    Napi::Function NotificationWrap::Constructor(const Napi::Env& env) {
        return DefineClass(env, "NotificationNative", {
            StaticMethod("isSupported", &NotificationWrap::IsSupported),
            InstanceMethod("show", &NotificationWrap::Show),
            InstanceMethod("close", &NotificationWrap::Close),
        });
    }
}
