#include "clipboard_wrap.h"

#include <deskgap/clipboard.hpp>
#include "../dispatch/dispatch.h"

Napi::Object DeskGap::ClipboardObject(const Napi::Env& env) {
    Napi::Object clipboardObject = Napi::Object::New(env);
    clipboardObject.Set("readText", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::string text;
        UISync(info.Env(), [&text] { text = Clipboard::ReadText(); });
        return Napi::String::New(info.Env(), text);
    }));
    clipboardObject.Set("writeText", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::string text = info[0].As<Napi::String>().Utf8Value();
        bool result;
        UISync(info.Env(), [&result, &text] { result = Clipboard::WriteText(text); });
        return Napi::Boolean::New(info.Env(), result);
    }));
    clipboardObject.Set("writeImage", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
        std::vector<uint8_t> png(buffer.Data(), buffer.Data() + buffer.Length());
        bool result;
        UISync(info.Env(), [&result, &png] { result = Clipboard::WriteImage(png); });
        return Napi::Boolean::New(info.Env(), result);
    }));
    return clipboardObject;
}
