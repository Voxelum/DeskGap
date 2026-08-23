#include <deskgap/shell.hpp>
#include "shell_wrap.h"
#include "../dispatch/ui_dispatch.h"
#include "../util/js_native_convert.h"

namespace DeskGap::JSNativeConvertion {
    template<>
    struct Native<Shell::ShortcutDetails> {
        inline static Shell::ShortcutDetails From(const Napi::Value& jsValue) {
            Napi::Object jsDetails = jsValue.As<Napi::Object>();
            Shell::ShortcutDetails details;
            ToNative(details.target, jsDetails.Get("target"));
            ToNative(details.cwd, jsDetails.Get("cwd"));
            ToNative(details.args, jsDetails.Get("args"));
            ToNative(details.description, jsDetails.Get("description"));
            ToNative(details.icon, jsDetails.Get("icon"));
            ToNative(details.iconIndex, jsDetails.Get("iconIndex"));
            ToNative(details.appUserModelId, jsDetails.Get("appUserModelId"));
            ToNative(details.toastActivatorClsid, jsDetails.Get("toastActivatorClsid"));
            return details;
        }
    };
}

Napi::Object DeskGap::ShellObject(const Napi::Env& env) {
    Napi::Object shellObject = Napi::Object::New(env);
    shellObject.Set("openExternal",  Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        bool success;
        std::string urlString = info[0].As<Napi::String>();
        UISync(info.Env(), [&]() {
        	success = Shell::OpenExternal(urlString);
        });
        return Napi::Boolean::New(info.Env(), success);
    }));
    shellObject.Set("openPath", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::string error;
        std::string pathString = info[0].As<Napi::String>();
        UISync(info.Env(), [&]() {
            error = Shell::OpenPath(pathString);
        });
        return Napi::String::New(info.Env(), error);
    }));
    shellObject.Set("showItemInFolder", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::string pathString = info[0].As<Napi::String>();
        UISync(info.Env(), [&]() {
        	Shell::ShowItemInFolder(pathString);
        });
    }));
    shellObject.Set("writeShortcutLink", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::string pathString = info[0].As<Napi::String>();
        std::string operation = info[1].As<Napi::String>();
        auto details = JSNativeConvertion::Native<Shell::ShortcutDetails>::From(info[2]);
        bool success;
        UISync(info.Env(), [&]() {
            success = Shell::WriteShortcutLink(pathString, operation, details);
        });
        return Napi::Boolean::New(info.Env(), success);
    }));
    return shellObject;
}
